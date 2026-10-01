import {
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__INVALID_PARAMS,
  SOLANA_ERROR__JSON_RPC__INVALID_REQUEST,
  SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND,
  SOLANA_ERROR__JSON_RPC__PARSE_ERROR,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";
import { ProviderError } from "@sct/providers";
import { ZodError } from "zod";

const NON_RETRYABLE_JSON_RPC_CODES = new Set<number>([
  SOLANA_ERROR__JSON_RPC__INVALID_PARAMS,
  SOLANA_ERROR__JSON_RPC__INVALID_REQUEST,
  SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND,
  SOLANA_ERROR__JSON_RPC__PARSE_ERROR,
  // A failed preflight is the node's definitive answer for this signed transaction.
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
]);

function retryAfterMs(headers: unknown): number | undefined {
  if (!headers || typeof (headers as Headers).get !== "function") return undefined;
  const value = (headers as Headers).get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Maps errors thrown by `@solana/kit` RPC calls (and our response validation) to ProviderError kinds. */
export function classifyRpcError(providerId: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof ZodError) {
    return new ProviderError({
      providerId,
      kind: "INVALID_RESPONSE",
      message: "RPC response failed schema validation",
      retryable: false,
      cause: error,
    });
  }

  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const statusCode = error.context.statusCode;
    if (statusCode === 429) {
      return new ProviderError({
        providerId,
        kind: "RATE_LIMITED",
        message: "RPC responded with HTTP 429",
        retryable: true,
        retryAfterMs: retryAfterMs(error.context.headers),
        responseStatus: statusCode,
        cause: error,
      });
    }
    return new ProviderError({
      providerId,
      kind: "UNAVAILABLE",
      message: `RPC responded with HTTP ${statusCode}`,
      retryable: statusCode >= 500,
      responseStatus: statusCode,
      cause: error,
    });
  }

  if (isSolanaError(error)) {
    return new ProviderError({
      providerId,
      kind: "UNAVAILABLE",
      message: "RPC returned a JSON-RPC error",
      retryable: !NON_RETRYABLE_JSON_RPC_CODES.has(error.context.__code),
      cause: error,
    });
  }

  // fetch() network failures surface as TypeError.
  return new ProviderError({
    providerId,
    kind: "UNAVAILABLE",
    message: error instanceof TypeError ? "RPC endpoint is unreachable" : "Unexpected RPC failure",
    retryable: true,
    cause: error,
  });
}

/**
 * SPEC-006 PH-AC-07: a failure the fallback endpoint may fix — transport failures,
 * timeouts, rate limits, and malformed responses. A JSON-RPC error response is a
 * definitive answer from a node (invalid parameters, failed preflight) and is not retried elsewhere.
 */
export function isFailoverEligible(error: ProviderError): boolean {
  if (error.kind !== "UNAVAILABLE") return true;
  const cause: unknown = error.cause;
  return !(isSolanaError(cause) && !isSolanaError(cause, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR));
}
