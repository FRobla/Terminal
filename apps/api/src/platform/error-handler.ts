import type { ErrorResponse } from "@sct/validation";
import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { ApiError, defaultErrorMessage } from "./api-error";

/**
 * Renders every error in the standard format. Unexpected errors are logged with
 * full detail server-side and returned as INTERNAL_ERROR without internals.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;

    if (error instanceof ApiError) {
      const body: ErrorResponse = {
        code: error.code,
        message: error.message,
        requestId,
        details: error.details,
      };
      return reply.status(error.statusCode).send(body);
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ErrorResponse = {
        code: "VALIDATION_FAILED",
        message: defaultErrorMessage("VALIDATION_FAILED"),
        requestId,
        details: {
          issues: error.validation.map((issue) => ({
            path: `${error.validationContext ?? "request"}${issue.instancePath.replaceAll("/", ".")}`,
            message: issue.message,
          })),
        },
      };
      return reply.status(400).send(body);
    }

    if (error.statusCode === 429) {
      const body: ErrorResponse = {
        code: "RATE_LIMITED",
        message: defaultErrorMessage("RATE_LIMITED"),
        requestId,
        details: {},
      };
      return reply.status(429).send(body);
    }

    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      // Framework-level client errors (malformed JSON, unsupported media type, body too large).
      const body: ErrorResponse = {
        code: "VALIDATION_FAILED",
        message: defaultErrorMessage("VALIDATION_FAILED"),
        requestId,
        details: {},
      };
      return reply.status(400).send(body);
    }

    request.log.error({ err: error }, "Unhandled error");
    const body: ErrorResponse = {
      code: "INTERNAL_ERROR",
      message: defaultErrorMessage("INTERNAL_ERROR"),
      requestId,
      details: {},
    };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = {
      code: "NOT_FOUND",
      message: defaultErrorMessage("NOT_FOUND"),
      requestId: request.id,
      details: {},
    };
    return reply.status(404).send(body);
  });
}
