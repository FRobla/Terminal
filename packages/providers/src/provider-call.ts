import type { ConcurrencyLimiter } from "./concurrency";
import { ProviderError } from "./errors";
import type { ProviderHealthStore } from "./health";
import type { ProviderDescriptor } from "./provider";
import type { RateLimiter } from "./rate-limiter";

export interface ProviderCallDependencies {
  limiter: RateLimiter;
  health: ProviderHealthStore;
  concurrency: ConcurrencyLimiter;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Called when health bookkeeping fails; the provider call itself is unaffected. */
  onInternalError?: (error: unknown) => void;
}

export interface ProviderCallRequest<T> {
  provider: ProviderDescriptor;
  method: string;
  execute: (signal: AbortSignal) => Promise<T>;
  /** Converts any thrown value into a classified ProviderError. */
  classify: (error: unknown) => ProviderError;
}

export interface ProviderCallResult<T> {
  value: T;
  latencyMs: number;
  attempts: number;
  retrievedAt: Date;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter. */
export function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

/**
 * Executes one logical provider request with: distributed budget (total and per
 * method), per-process concurrency limit, timeout, classified errors, bounded
 * retries with backoff and jitter, and health recording (ARCHITECTURE.md §10).
 * Rate-limit responses are never retried immediately.
 */
export async function executeProviderCall<T>(
  deps: ProviderCallDependencies,
  request: ProviderCallRequest<T>,
): Promise<ProviderCallResult<T>> {
  const { provider, method } = request;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const bookkeeping = (promise: Promise<void>) =>
    promise.catch((error: unknown) => deps.onInternalError?.(error));

  let attempt = 0;
  for (;;) {
    attempt += 1;

    const budget = await acquireBudget(deps, provider, method);
    if (!budget.allowed) {
      const error = new ProviderError({
        providerId: provider.id,
        kind: "RATE_LIMITED",
        message: "Internal request budget for this provider is exhausted",
        retryable: true,
        retryAfterMs: budget.retryAfterMs,
      });
      error.attempts = attempt;
      await bookkeeping(deps.health.recordFailure(provider.id, error, undefined, now()));
      throw error;
    }

    const startedAt = performance.now();
    try {
      const value = await deps.concurrency.run(() => withTimeout(request.execute, provider.timeoutMs));
      const latencyMs = Math.round(performance.now() - startedAt);
      const retrievedAt = now();
      await bookkeeping(deps.health.recordSuccess(provider.id, latencyMs, retrievedAt));
      return { value, latencyMs, attempts: attempt, retrievedAt };
    } catch (raw) {
      const latencyMs = Math.round(performance.now() - startedAt);
      const error =
        raw instanceof TimeoutSignal
          ? new ProviderError({
              providerId: provider.id,
              kind: "TIMEOUT",
              message: `No response within ${provider.timeoutMs} ms`,
              cause: raw,
            })
          : request.classify(raw);
      error.attempts = attempt;
      await bookkeeping(deps.health.recordFailure(provider.id, error, latencyMs, now()));

      const canRetry =
        error.retryable && error.kind !== "RATE_LIMITED" && attempt < provider.retry.maxAttempts;
      if (!canRetry) throw error;
      await sleep(backoffDelayMs(attempt, provider.retry.baseDelayMs, provider.retry.maxDelayMs, random));
    }
  }
}

async function acquireBudget(deps: ProviderCallDependencies, provider: ProviderDescriptor, method: string) {
  const total = await deps.limiter.acquire(`${provider.id}:total`, {
    capacity: provider.budget.requestsPerWindow,
    windowMs: provider.budget.windowMs,
  });
  if (!total.allowed || provider.budget.perMethodRequestsPerWindow === undefined) return total;
  return deps.limiter.acquire(`${provider.id}:method:${method}`, {
    capacity: provider.budget.perMethodRequestsPerWindow,
    windowMs: provider.budget.windowMs,
  });
}

class TimeoutSignal extends Error {
  constructor() {
    super("Provider call timed out");
    this.name = "TimeoutSignal";
  }
}

async function withTimeout<T>(execute: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new TimeoutSignal());
      reject(new TimeoutSignal());
    }, timeoutMs);
  });
  const task = execute(controller.signal);
  // A late rejection after the timeout has already won must not become an unhandled rejection.
  task.catch(() => undefined);
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
