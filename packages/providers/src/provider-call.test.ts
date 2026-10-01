import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter } from "./concurrency";
import { ProviderError } from "./errors";
import type { HealthSnapshot, ProviderHealthStore } from "./health";
import type { ProviderDescriptor } from "./provider";
import { backoffDelayMs, executeProviderCall, type ProviderCallDependencies } from "./provider-call";
import type { RateLimiter } from "./rate-limiter";

const provider: ProviderDescriptor = {
  id: "test-rpc",
  displayName: "Test RPC",
  sourceType: "rpc",
  network: "devnet",
  endpoint: "https://rpc.example.com",
  authMode: "none",
  budget: { requestsPerWindow: 10, windowMs: 10_000, perMethodRequestsPerWindow: 5, maxConcurrency: 2 },
  timeoutMs: 50,
  retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
  degradedLatencyMs: 1000,
  docsUrl: "https://example.com",
  lastVerifiedAt: "2026-09-30",
};

class RecordingHealthStore implements ProviderHealthStore {
  successes = 0;
  failures: string[] = [];
  async recordSuccess() {
    this.successes += 1;
  }
  async recordFailure(_id: string, failure: { kind: string }) {
    this.failures.push(failure.kind);
  }
  async setVerificationFailure() {}
  async setDisabled() {}
  async read(): Promise<HealthSnapshot> {
    throw new Error("not used");
  }
}

function dependencies(
  limiter?: RateLimiter,
): ProviderCallDependencies & { health: RecordingHealthStore; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    limiter: limiter ?? { acquire: async () => ({ allowed: true, retryAfterMs: 0 }) },
    health: new RecordingHealthStore(),
    concurrency: new ConcurrencyLimiter(2),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1,
    sleeps,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error("Expected the provider call to fail");
}

const unavailable = () =>
  new ProviderError({ providerId: provider.id, kind: "UNAVAILABLE", message: "down", retryable: true });

describe("executeProviderCall", () => {
  it("returns the value and records success", async () => {
    const deps = dependencies();
    const result = await executeProviderCall(deps, {
      provider,
      method: "getSlot",
      execute: async () => 42,
      classify: unavailable,
    });
    expect(result.value).toBe(42);
    expect(result.attempts).toBe(1);
    expect(deps.health.successes).toBe(1);
  });

  it("retries retryable failures with exponential backoff and jitter, then succeeds", async () => {
    const deps = dependencies();
    let calls = 0;
    const result = await executeProviderCall(deps, {
      provider,
      method: "getSlot",
      execute: async () => {
        calls += 1;
        if (calls < 3) throw new Error("boom");
        return "ok";
      },
      classify: unavailable,
    });
    expect(result.attempts).toBe(3);
    expect(deps.sleeps).toEqual([10, 20]);
    expect(deps.health.failures).toEqual(["UNAVAILABLE", "UNAVAILABLE"]);
  });

  it("gives up after maxAttempts and exposes the attempt count", async () => {
    const deps = dependencies();
    const error = await rejectionOf(
      executeProviderCall(deps, {
        provider,
        method: "getSlot",
        execute: async () => {
          throw new Error("boom");
        },
        classify: unavailable,
      }),
    );
    expect(error.attempts).toBe(3);
  });

  it("WO-AC-12: never retries a provider rate-limit response", async () => {
    const deps = dependencies();
    let calls = 0;
    const error = await rejectionOf(
      executeProviderCall(deps, {
        provider,
        method: "getSlot",
        execute: async () => {
          calls += 1;
          throw new Error("429");
        },
        classify: () =>
          new ProviderError({
            providerId: provider.id,
            kind: "RATE_LIMITED",
            message: "429",
            retryAfterMs: 5000,
          }),
      }),
    );
    expect(calls).toBe(1);
    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.retryAfterMs).toBe(5000);
  });

  it("WO-AC-12: fails fast without calling the provider when the internal budget is exhausted", async () => {
    const deps = dependencies({ acquire: async () => ({ allowed: false, retryAfterMs: 1234 }) });
    let calls = 0;
    const error = await rejectionOf(
      executeProviderCall(deps, {
        provider,
        method: "getSlot",
        execute: async () => {
          calls += 1;
          return 1;
        },
        classify: unavailable,
      }),
    );
    expect(calls).toBe(0);
    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.retryAfterMs).toBe(1234);
    expect(deps.health.failures).toEqual(["RATE_LIMITED"]);
  });

  it("WO-AC-11: classifies a slow provider as TIMEOUT and aborts the request", async () => {
    const deps = dependencies();
    let aborted = false;
    const error = await rejectionOf(
      executeProviderCall(deps, {
        provider: { ...provider, retry: { ...provider.retry, maxAttempts: 1 } },
        method: "getSlot",
        execute: (signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
            setTimeout(() => resolve(1), 500);
          }),
        classify: unavailable,
      }),
    );
    expect(error.kind).toBe("TIMEOUT");
    expect(aborted).toBe(true);
  });

  it("checks the per-method budget after the total budget", async () => {
    const keys: string[] = [];
    const deps = dependencies({
      acquire: async (key) => {
        keys.push(key);
        return { allowed: true, retryAfterMs: 0 };
      },
    });
    await executeProviderCall(deps, {
      provider,
      method: "getBalance",
      execute: async () => 1,
      classify: unavailable,
    });
    expect(keys).toEqual(["test-rpc:total", "test-rpc:method:getBalance"]);
  });
});

describe("backoffDelayMs", () => {
  it("caps the delay at maxDelayMs", () => {
    expect(backoffDelayMs(10, 100, 1000, () => 1)).toBe(1000);
    expect(backoffDelayMs(1, 100, 1000, () => 0.5)).toBe(50);
  });
});
