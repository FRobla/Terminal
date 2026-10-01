import { errorResponseSchema, successEnvelope, type ErrorCode } from "@sct/validation";
import type { z } from "zod";

/** A failed API call in the standard error format (API.md §3). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE",
    message: string,
    readonly requestId: string | undefined,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Browser-side client for the same-origin API. Every success and error body is
 * validated at runtime; the terminal never trusts response shapes blindly.
 */
export async function apiRequest<T extends z.ZodType>(
  path: string,
  dataSchema: T,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    csrfToken?: string | undefined;
    signal?: AbortSignal;
  } = {},
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.csrfToken ? { "x-csrf-token": options.csrfToken } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError(0, "NETWORK_ERROR", "The terminal could not reach its API.", undefined);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.code,
        parsed.data.message,
        parsed.data.requestId,
      );
    }
    throw new ApiRequestError(
      response.status,
      "INVALID_RESPONSE",
      `Unexpected API response (HTTP ${response.status}).`,
      undefined,
    );
  }

  const parsed = successEnvelope(dataSchema).safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError(
      response.status,
      "INVALID_RESPONSE",
      "The API response failed validation.",
      undefined,
    );
  }
  return (parsed.data as { data: z.infer<T> }).data;
}
