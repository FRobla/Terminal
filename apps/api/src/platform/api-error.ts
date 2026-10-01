import type { ErrorCode } from "@sct/validation";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  WALLET_ADDRESS_INVALID: 400,
  CLUSTER_MISMATCH: 409,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  CSRF_TOKEN_INVALID: 403,
  SIWS_CHALLENGE_INVALID: 400,
  SIWS_SIGNATURE_INVALID: 401,
  ACCOUNT_DISABLED: 403,
  NOT_FOUND: 404,
  OPERATION_NOT_ALLOWED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  RPC_UNAVAILABLE: 503,
  RPC_RATE_LIMITED: 503,
  CLUSTER_VERIFICATION_FAILED: 503,
  PROVIDER_UNAVAILABLE: 503,
  NETWORK_NOT_PERMITTED: 403,
  INTERNAL_ERROR: 500,
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "The request failed validation.",
  WALLET_ADDRESS_INVALID: "The provided value is not a valid Solana address.",
  CLUSTER_MISMATCH: "The requested cluster does not match the cluster configured for this terminal.",
  UNAUTHENTICATED: "Sign in to continue.",
  SESSION_EXPIRED: "Your session has expired. Sign in again.",
  FORBIDDEN: "You do not have permission to perform this action.",
  CSRF_TOKEN_INVALID: "The request could not be verified. Reload the page and try again.",
  SIWS_CHALLENGE_INVALID: "The sign-in request is unknown, expired, or already used. Start sign-in again.",
  SIWS_SIGNATURE_INVALID: "The sign-in signature could not be verified.",
  ACCOUNT_DISABLED: "This account is disabled. Contact the organization owner.",
  NOT_FOUND: "The requested resource could not be found.",
  OPERATION_NOT_ALLOWED: "This operation is not allowed for the selected account or resource.",
  IDEMPOTENCY_CONFLICT: "The idempotency key was already used with a different request.",
  RATE_LIMITED: "Too many requests. Try again later.",
  RPC_UNAVAILABLE: "The Solana RPC endpoint is unavailable.",
  RPC_RATE_LIMITED: "The Solana RPC rate limit was reached. Try again later.",
  CLUSTER_VERIFICATION_FAILED:
    "The Solana RPC cluster could not be verified. Blockchain operations are disabled.",
  PROVIDER_UNAVAILABLE: "An external data provider is unavailable.",
  NETWORK_NOT_PERMITTED: "This operation targets a network that is not permitted in this environment.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

/** An expected, client-facing error rendered in the standard error format (API.md §3). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, options: { message?: string; details?: Record<string, unknown> } = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = options.details ?? {};
  }
}

export function defaultErrorMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
