import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";

/** Correlation fields attached to every log line and audit event (SPEC-001 §3.3). */
export interface RequestContext {
  requestId: string;
  traceId: string;
  feature?: string;
  operation?: string;
  organizationId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Mutates the active context (e.g. once the session resolves the user). */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Accepts a client-provided request id only if it is well formed; otherwise generates one. */
export function resolveRequestId(candidate: unknown): string {
  return typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

/** Uses the active OpenTelemetry trace id when tracing is enabled; otherwise a fresh random id. */
export function resolveTraceId(): string {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext && spanContext.traceId !== "00000000000000000000000000000000") {
    return spanContext.traceId;
  }
  return randomBytes(16).toString("hex");
}

export function newRequestContext(fields: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: fields.requestId ?? randomUUID(),
    traceId: fields.traceId ?? resolveTraceId(),
    ...fields,
  };
}
