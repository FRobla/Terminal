import type { ProviderHealth, ProviderStatus } from "@sct/validation";
import type { ProviderFailureKind } from "./errors";
import type { ProviderDescriptor } from "./provider";

/** SPEC-006 — provider health evaluation. */

export const HEALTH_WINDOW_MS = 5 * 60_000;
/** A 429 or exhausted budget keeps the provider RATE_LIMITED for this long unless a reset time is known. */
export const RATE_LIMITED_HOLD_MS = 60_000;
/** Error-rate thresholds apply only once the window has this many requests. */
export const MIN_REQUESTS_FOR_ERROR_RATE = 5;
export const UNAVAILABLE_CONSECUTIVE_FAILURES = 3;
export const DEGRADED_ERROR_RATE = 0.05;
export const UNAVAILABLE_ERROR_RATE = 0.25;

export interface HealthSnapshot {
  requests: number;
  failures: number;
  latenciesMs: number[];
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
  lastRateLimitedAt: Date | null;
  rateLimitResetAt: Date | null;
  disabled: boolean;
  verificationFailure: string | null;
}

export interface ProviderHealthStore {
  recordSuccess(providerId: string, latencyMs: number, at: Date): Promise<void>;
  recordFailure(
    providerId: string,
    failure: { kind: ProviderFailureKind; message: string; retryAfterMs?: number | undefined },
    latencyMs: number | undefined,
    at: Date,
  ): Promise<void>;
  setVerificationFailure(providerId: string, reason: string | null): Promise<void>;
  setDisabled(providerId: string, disabled: boolean): Promise<void>;
  read(providerId: string, at: Date): Promise<HealthSnapshot>;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function evaluateProviderStatus(
  descriptor: Pick<ProviderDescriptor, "degradedLatencyMs">,
  snapshot: HealthSnapshot,
  now: Date,
): ProviderStatus {
  if (snapshot.disabled) return "DISABLED";
  if (snapshot.verificationFailure) return "UNAVAILABLE";

  const rateLimitActive =
    (snapshot.rateLimitResetAt !== null && snapshot.rateLimitResetAt.getTime() > now.getTime()) ||
    (snapshot.lastRateLimitedAt !== null &&
      now.getTime() - snapshot.lastRateLimitedAt.getTime() < RATE_LIMITED_HOLD_MS);
  if (rateLimitActive) return "RATE_LIMITED";

  if (snapshot.consecutiveFailures >= UNAVAILABLE_CONSECUTIVE_FAILURES) return "UNAVAILABLE";

  if (snapshot.requests === 0) {
    return snapshot.lastSuccessAt || snapshot.lastFailureAt ? "HEALTHY" : "UNKNOWN";
  }

  const errorRate = snapshot.failures / snapshot.requests;
  if (snapshot.requests >= MIN_REQUESTS_FOR_ERROR_RATE) {
    if (errorRate > UNAVAILABLE_ERROR_RATE) return "UNAVAILABLE";
    if (errorRate >= DEGRADED_ERROR_RATE) return "DEGRADED";
  } else if (snapshot.consecutiveFailures > 0) {
    return "DEGRADED";
  }

  const p95 = percentile(snapshot.latenciesMs, 95);
  if (p95 !== null && p95 > descriptor.degradedLatencyMs) return "DEGRADED";
  return "HEALTHY";
}

export function toProviderHealth(
  descriptor: Pick<ProviderDescriptor, "id" | "displayName" | "network" | "degradedLatencyMs">,
  snapshot: HealthSnapshot,
  now: Date,
): ProviderHealth {
  const status = evaluateProviderStatus(descriptor, snapshot, now);
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  const p50 = percentile(snapshot.latenciesMs, 50);
  const p95 = percentile(snapshot.latenciesMs, 95);
  return {
    providerId: descriptor.id,
    displayName: descriptor.displayName,
    network: descriptor.network,
    status,
    latencyP50Ms: p50 === null ? null : Math.round(p50),
    latencyP95Ms: p95 === null ? null : Math.round(p95),
    requestCount: snapshot.requests,
    errorRate: snapshot.requests === 0 ? null : Number((snapshot.failures / snapshot.requests).toFixed(4)),
    lastSuccessAt: iso(snapshot.lastSuccessAt),
    lastFailureAt: iso(snapshot.lastFailureAt),
    lastFailureReason: snapshot.verificationFailure ?? snapshot.lastFailureReason,
    rateLimit: {
      limited: status === "RATE_LIMITED",
      resetAt: iso(snapshot.rateLimitResetAt),
      lastRateLimitedAt: iso(snapshot.lastRateLimitedAt),
    },
    checkedAt: now.toISOString(),
  };
}
