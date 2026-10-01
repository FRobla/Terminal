import { describe, expect, it } from "vitest";
import { evaluateProviderStatus, percentile, toProviderHealth, type HealthSnapshot } from "./health";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const descriptor = { id: "rpc", displayName: "RPC", network: "devnet" as const, degradedLatencyMs: 2000 };

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    requests: 0,
    failures: 0,
    latenciesMs: [],
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastRateLimitedAt: null,
    rateLimitResetAt: null,
    disabled: false,
    verificationFailure: null,
    ...overrides,
  };
}

describe("evaluateProviderStatus", () => {
  it("is UNKNOWN before any request or probe", () => {
    expect(evaluateProviderStatus(descriptor, snapshot(), NOW)).toBe("UNKNOWN");
  });

  it("PH-AC-01: transitions HEALTHY → DEGRADED → UNAVAILABLE as the error rate rises, and recovers", () => {
    const healthy = snapshot({ requests: 100, failures: 1, latenciesMs: [100, 200], lastSuccessAt: NOW });
    expect(evaluateProviderStatus(descriptor, healthy, NOW)).toBe("HEALTHY");
    expect(evaluateProviderStatus(descriptor, { ...healthy, failures: 10 }, NOW)).toBe("DEGRADED");
    expect(evaluateProviderStatus(descriptor, { ...healthy, failures: 30 }, NOW)).toBe("UNAVAILABLE");
    expect(evaluateProviderStatus(descriptor, { ...healthy, failures: 0 }, NOW)).toBe("HEALTHY");
  });

  it("PH-AC-01: three consecutive failures make the provider UNAVAILABLE even with few requests", () => {
    expect(
      evaluateProviderStatus(descriptor, snapshot({ requests: 3, failures: 3, consecutiveFailures: 3 }), NOW),
    ).toBe("UNAVAILABLE");
    expect(
      evaluateProviderStatus(descriptor, snapshot({ requests: 2, failures: 1, consecutiveFailures: 1 }), NOW),
    ).toBe("DEGRADED");
  });

  it("is DEGRADED when p95 latency exceeds the provider threshold", () => {
    const slow = snapshot({ requests: 20, latenciesMs: Array.from({ length: 20 }, () => 2500) });
    expect(evaluateProviderStatus(descriptor, slow, NOW)).toBe("DEGRADED");
  });

  it("PH-AC-02: a recent 429 or a future reset time means RATE_LIMITED", () => {
    const recent = snapshot({ requests: 10, lastRateLimitedAt: new Date(NOW.getTime() - 10_000) });
    expect(evaluateProviderStatus(descriptor, recent, NOW)).toBe("RATE_LIMITED");
    const reset = snapshot({ rateLimitResetAt: new Date(NOW.getTime() + 5_000) });
    expect(evaluateProviderStatus(descriptor, reset, NOW)).toBe("RATE_LIMITED");
    const old = snapshot({ requests: 10, lastRateLimitedAt: new Date(NOW.getTime() - 120_000) });
    expect(evaluateProviderStatus(descriptor, old, NOW)).toBe("HEALTHY");
  });

  it("DISABLED and failed cluster verification take precedence", () => {
    expect(evaluateProviderStatus(descriptor, snapshot({ disabled: true, requests: 5 }), NOW)).toBe(
      "DISABLED",
    );
    expect(evaluateProviderStatus(descriptor, snapshot({ verificationFailure: "mismatch" }), NOW)).toBe(
      "UNAVAILABLE",
    );
  });
});

describe("toProviderHealth", () => {
  it("PH-AC-04: reports latency percentiles, error rate, and rate-limit state", () => {
    const health = toProviderHealth(
      descriptor,
      snapshot({ requests: 4, failures: 1, latenciesMs: [100, 200, 300, 400], lastSuccessAt: NOW }),
      NOW,
    );
    expect(health.latencyP50Ms).toBe(200);
    expect(health.latencyP95Ms).toBe(400);
    expect(health.errorRate).toBe(0.25);
    expect(health.rateLimit.limited).toBe(false);
    expect(health.checkedAt).toBe(NOW.toISOString());
  });
});

describe("percentile", () => {
  it("returns null for no samples", () => {
    expect(percentile([], 50)).toBeNull();
  });
});
