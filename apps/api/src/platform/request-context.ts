import { resolveTraceId, runWithRequestContext, type RequestContext } from "@sct/observability";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requestContext: RequestContext;
  }
}

/**
 * Establishes the request context (request id, trace id, operation) for the whole
 * request lifecycle and writes exactly one completion log line per request (FND-AC-04).
 */
export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest("requestContext", undefined as unknown as RequestContext);

  app.addHook("onRequest", (request, reply, done) => {
    const context: RequestContext = {
      requestId: request.id,
      traceId: resolveTraceId(),
      operation: `${request.method} ${request.routeOptions.url ?? "unmatched"}`,
    };
    request.requestContext = context;
    reply.header("x-request-id", request.id);
    runWithRequestContext(context, () => done());
  });

  app.addHook("onResponse", (request, reply, done) => {
    const statusCode = reply.statusCode;
    const { requestId, traceId, operation, userId, organizationId } = request.requestContext;
    request.log.info(
      {
        requestId,
        traceId,
        operation,
        userId,
        organizationId,
        durationMs: Math.round(reply.elapsedTime),
        statusCode,
        result: statusCode >= 500 ? "error" : statusCode >= 400 ? "rejected" : "success",
      },
      "request completed",
    );
    done();
  });
}
