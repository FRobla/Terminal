export const PROVIDER_FAILURE_KINDS = ["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "INVALID_RESPONSE"] as const;

export type ProviderFailureKind = (typeof PROVIDER_FAILURE_KINDS)[number];

/**
 * A classified failure of an external provider call. Messages must not contain
 * credentials or raw payloads; they are surfaced in health views and logs.
 */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly kind: ProviderFailureKind;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly responseStatus: number | undefined;
  attempts = 0;

  constructor(options: {
    providerId: string;
    kind: ProviderFailureKind;
    message: string;
    retryable?: boolean;
    retryAfterMs?: number | undefined;
    responseStatus?: number | undefined;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderError";
    this.providerId = options.providerId;
    this.kind = options.kind;
    // Rate limits are retryable later (after retryAfterMs); the call pipeline never retries them immediately.
    this.retryable = options.retryable ?? options.kind !== "INVALID_RESPONSE";
    this.retryAfterMs = options.retryAfterMs;
    this.responseStatus = options.responseStatus;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
