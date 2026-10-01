import { ProviderError } from "@sct/providers";
import { SOLANA_ERROR__JSON_RPC__INVALID_PARAMS, SolanaError } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { FailoverRpcClient } from "./failover-rpc-client";
import { isFailoverEligible } from "./rpc-error-classifier";
import type { SolanaRpcClient } from "./solana-rpc-client";

function endpoint(id: string, behavior: () => Promise<unknown>) {
  const descriptor = { id, network: "devnet" };
  return {
    network: "devnet",
    descriptor,
    call: vi.fn(async () => ({
      value: await behavior(),
      latencyMs: 1,
      attempts: 1,
      retrievedAt: new Date(),
      servedBy: descriptor,
      fallbackUsed: false,
    })),
  } as unknown as SolanaRpcClient & { call: ReturnType<typeof vi.fn> };
}

const outage = new ProviderError({ providerId: "primary", kind: "UNAVAILABLE", message: "HTTP 503" });

describe("FailoverRpcClient (SPEC-006 amendment)", () => {
  it("PH-AC-07: serves from the fallback when the primary fails with an eligible error", async () => {
    const primary = endpoint("primary", () => Promise.reject(outage));
    const fallback = endpoint("fallback", () => Promise.resolve(7));
    const client = new FailoverRpcClient(primary, fallback, () => true);
    const result = await client.call("getSlot", async () => 0);
    expect(result).toMatchObject({ value: 7, fallbackUsed: true, servedBy: { id: "fallback" } });
  });

  it("PH-AC-07: reports the primary error when both fail", async () => {
    const primary = endpoint("primary", () => Promise.reject(outage));
    const fallback = endpoint("fallback", () =>
      Promise.reject(new ProviderError({ providerId: "fallback", kind: "TIMEOUT", message: "slow" })),
    );
    await expect(
      new FailoverRpcClient(primary, fallback, () => true).call("getSlot", async () => 0),
    ).rejects.toBe(outage);
  });

  it("PH-AC-08: never calls an unverified fallback", async () => {
    const primary = endpoint("primary", () => Promise.reject(outage));
    const fallback = endpoint("fallback", () => Promise.resolve(7));
    await expect(
      new FailoverRpcClient(primary, fallback, () => false).call("getSlot", async () => 0),
    ).rejects.toBe(outage);
    expect(fallback.call).not.toHaveBeenCalled();
  });

  it("PH-AC-07: JSON-RPC error answers are definitive; transport failures are eligible", () => {
    const jsonRpc = new ProviderError({
      providerId: "primary",
      kind: "UNAVAILABLE",
      message: "RPC returned a JSON-RPC error",
      retryable: false,
      cause: new SolanaError(SOLANA_ERROR__JSON_RPC__INVALID_PARAMS, { __serverMessage: "bad" }),
    });
    expect(isFailoverEligible(jsonRpc)).toBe(false);
    expect(isFailoverEligible(outage)).toBe(true);
    for (const kind of ["TIMEOUT", "RATE_LIMITED", "INVALID_RESPONSE"] as const) {
      expect(isFailoverEligible(new ProviderError({ providerId: "p", kind, message: kind }))).toBe(true);
    }
  });
});
