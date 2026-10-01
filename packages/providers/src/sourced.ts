import type { Provenance, Sourced, UnavailableInfo, UnavailableReason } from "@sct/validation";
import type { ProviderError, ProviderFailureKind } from "./errors";

/** SPEC-003 builders. The only way runtime code should construct `Sourced<T>` values. */

export function available<T>(value: T, provenance: Provenance): Sourced<T> {
  return { status: "AVAILABLE", value, provenance };
}

export function unavailable(info: UnavailableInfo): Sourced<never> {
  return { status: "UNAVAILABLE", value: null, provenance: null, unavailable: info };
}

/** Marks a value served from cache: original retrieval time and source are preserved (PRV-AC-03). */
export function fromCache<T>(value: Sourced<T>): Sourced<T> {
  if (value.status === "UNAVAILABLE") return value;
  return { ...value, provenance: { ...value.provenance, confidence: "CACHED" } };
}

const RPC_REASONS: Record<ProviderFailureKind, UnavailableReason> = {
  RATE_LIMITED: "RPC_RATE_LIMITED",
  TIMEOUT: "RPC_TIMEOUT",
  UNAVAILABLE: "RPC_UNAVAILABLE",
  INVALID_RESPONSE: "RPC_INVALID_RESPONSE",
};

const PROVIDER_REASONS: Record<ProviderFailureKind, UnavailableReason> = {
  RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  TIMEOUT: "PROVIDER_UNAVAILABLE",
  UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_RESPONSE: "PROVIDER_UNAVAILABLE",
};

const MESSAGES: Record<UnavailableReason, string> = {
  RPC_UNAVAILABLE: "The Solana RPC endpoint is unreachable or failing.",
  RPC_TIMEOUT: "The Solana RPC endpoint did not respond in time.",
  RPC_RATE_LIMITED: "The Solana RPC rate limit was reached.",
  RPC_INVALID_RESPONSE: "The Solana RPC endpoint returned a response that failed validation.",
  PROVIDER_UNAVAILABLE: "The data provider is unavailable.",
  PROVIDER_RATE_LIMITED: "The data provider rate limit was reached.",
  PROVIDER_NOT_CONFIGURED: "The data provider is not configured.",
  NOT_SUPPORTED_ON_NETWORK: "This data is not available on the selected network.",
  CLUSTER_UNVERIFIED: "The Solana RPC cluster could not be verified. Blockchain data is disabled.",
  DEPENDENCY_UNAVAILABLE: "A required input for this value is unavailable.",
};

export function unavailableMessage(reason: UnavailableReason): string {
  return MESSAGES[reason];
}

export function unavailableFromProviderError(
  error: ProviderError,
  options: { source: string; sourceType: Provenance["sourceType"]; lastSuccessfulRetrievalAt: string | null },
): Sourced<never> {
  const reason = (options.sourceType === "rpc" ? RPC_REASONS : PROVIDER_REASONS)[error.kind];
  return unavailable({
    reason,
    message: MESSAGES[reason],
    source: options.source,
    lastSuccessfulRetrievalAt: options.lastSuccessfulRetrievalAt,
    retry: {
      retryable: error.retryable,
      ...(error.retryAfterMs !== undefined
        ? { retryAfterMs: Math.max(0, Math.round(error.retryAfterMs)) }
        : {}),
      attempts: error.attempts,
    },
  });
}

export function unavailableForReason(
  reason: UnavailableReason,
  options: { source: string; lastSuccessfulRetrievalAt: string | null; retryable: boolean },
): Sourced<never> {
  return unavailable({
    reason,
    message: MESSAGES[reason],
    source: options.source,
    lastSuccessfulRetrievalAt: options.lastSuccessfulRetrievalAt,
    retry: { retryable: options.retryable, attempts: 0 },
  });
}
