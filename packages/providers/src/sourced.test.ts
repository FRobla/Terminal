import { sourcedSchema } from "@sct/validation";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { redactEndpoint } from "./endpoint-redaction";
import { ProviderError } from "./errors";
import { available, fromCache, unavailableFromProviderError } from "./sourced";

const provenance = {
  source: "solana-rpc-devnet",
  sourceType: "rpc" as const,
  provider: "solana-public-rpc",
  endpoint: "https://api.devnet.solana.com",
  method: "getBalance",
  network: "devnet" as const,
  retrievedAt: "2026-09-30T12:00:00.000Z",
  observedAt: null,
  requestId: "req-12345678",
  dataVersion: "sol-balance.v1",
  confidence: "AUTHORITATIVE" as const,
  fallbackUsed: false,
};

describe("Sourced builders", () => {
  it("PRV-AC-01: available values satisfy the contract schema", () => {
    const value = available({ amount: "1" }, provenance);
    expect(sourcedSchema(z.object({ amount: z.string() })).parse(value)).toEqual(value);
  });

  it("PRV-AC-02: provider failures produce UNAVAILABLE with a null value and retry state", () => {
    const error = new ProviderError({
      providerId: "rpc",
      kind: "RATE_LIMITED",
      message: "429",
      retryAfterMs: 10_000,
    });
    error.attempts = 1;
    const value = unavailableFromProviderError(error, {
      source: "solana-rpc-devnet",
      sourceType: "rpc",
      lastSuccessfulRetrievalAt: null,
    });
    expect(value.status).toBe("UNAVAILABLE");
    expect(value.value).toBeNull();
    if (value.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(value.unavailable.reason).toBe("RPC_RATE_LIMITED");
    expect(value.unavailable.retry).toEqual({ retryable: true, retryAfterMs: 10_000, attempts: 1 });
    expect(sourcedSchema(z.string()).safeParse(value).success).toBe(true);
  });

  it("maps non-RPC provider failures to provider reasons", () => {
    const error = new ProviderError({ providerId: "p", kind: "TIMEOUT", message: "slow" });
    const value = unavailableFromProviderError(error, {
      source: "market",
      sourceType: "rest",
      lastSuccessfulRetrievalAt: "2026-09-30T11:00:00.000Z",
    });
    if (value.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(value.unavailable.reason).toBe("PROVIDER_UNAVAILABLE");
    expect(value.unavailable.lastSuccessfulRetrievalAt).toBe("2026-09-30T11:00:00.000Z");
  });

  it("PRV-AC-03: cached values keep their original retrieval time", () => {
    const cached = fromCache(available(1, provenance));
    if (cached.status === "UNAVAILABLE") throw new Error("unreachable");
    expect(cached.provenance.retrievedAt).toBe(provenance.retrievedAt);
    expect(cached.provenance.confidence).toBe("CACHED");
  });
});

describe("redactEndpoint", () => {
  it("PRV-AC-05: strips credentials, query strings, and key-like path segments", () => {
    expect(redactEndpoint("https://mainnet.helius-rpc.com/?api-key=abcdef0123456789")).toBe(
      "https://mainnet.helius-rpc.com",
    );
    expect(redactEndpoint("https://user:pass@rpc.example.com/v1/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456")).toBe(
      "https://rpc.example.com/v1/[REDACTED]",
    );
    expect(redactEndpoint("https://api.devnet.solana.com")).toBe("https://api.devnet.solana.com");
    expect(redactEndpoint("not a url")).toBe("[invalid endpoint]");
  });
});
