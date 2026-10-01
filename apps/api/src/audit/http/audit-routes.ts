import { auditEventListQuerySchema, auditEventSchema, successEnvelope } from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireSession } from "../../auth/http/access-control";
import { ApiError } from "../../platform/api-error";
import { envelope } from "../../platform/envelope";
import type { AuditEventReader } from "../application/ports";

function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(`${occurredAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  const [occurredAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const date = occurredAt ? new Date(occurredAt) : null;
  if (!date || Number.isNaN(date.getTime()) || !id || !z.uuid().safeParse(id).success) {
    throw new ApiError("VALIDATION_FAILED", {
      details: { issues: [{ path: "query.cursor", message: "Invalid cursor" }] },
    });
  }
  return { occurredAt: date, id };
}

export const auditRoutes: FastifyPluginAsyncZod<{ reader: AuditEventReader }> = async (app, options) => {
  app.get(
    "/audit/events",
    {
      config: { access: { permission: "audit.read" } },
      schema: {
        querystring: auditEventListQuerySchema,
        response: { 200: successEnvelope(z.array(auditEventSchema)) },
      },
    },
    async (request) => {
      const session = requireSession(request);
      if (!session.organization) throw new ApiError("FORBIDDEN");
      const query = request.query;
      const events = await options.reader.list({
        organizationId: session.organization.id,
        limit: query.limit,
        cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
        action: query.action,
        actorId: query.actorId,
        resourceType: query.resourceType,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      });
      const last = events.at(-1);
      const nextCursor =
        events.length === query.limit && last ? encodeCursor(last.occurredAt, last.id) : null;
      return envelope(request, events, { nextCursor });
    },
  );
};
