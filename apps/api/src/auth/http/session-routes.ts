import {
  adminSessionSummarySchema,
  sessionIdParamsSchema,
  sessionRevocationResponseSchema,
  sessionSummarySchema,
  successEnvelope,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { envelope } from "../../platform/envelope";
import type { SessionAdministration } from "../application/session-administration";
import { requireActor } from "./access-control";

/** SPEC-025 §4 (own sessions) and SPEC-026 OWN-AC-08 (platform sessions). */
export const sessionRoutes: FastifyPluginAsyncZod<{ sessions: SessionAdministration }> = async (
  app,
  options,
) => {
  const revoked = { 200: successEnvelope(sessionRevocationResponseSchema) };

  app.get(
    "/me/sessions",
    {
      config: { access: { session: true } },
      schema: { response: { 200: successEnvelope(z.array(sessionSummarySchema)) } },
    },
    async (request) => envelope(request, await options.sessions.listOwn(requireActor(request))),
  );

  app.post(
    "/me/sessions/:sessionId/revoke",
    { config: { access: { session: true } }, schema: { params: sessionIdParamsSchema, response: revoked } },
    async (request) =>
      envelope(request, {
        revoked: await options.sessions.revokeOwn(requireActor(request), request.params.sessionId),
      }),
  );

  app.post(
    "/me/sessions/revoke-others",
    { config: { access: { session: true } }, schema: { response: revoked } },
    async (request) =>
      envelope(request, { revoked: await options.sessions.revokeOwnOthers(requireActor(request)) }),
  );

  app.get(
    "/admin/sessions",
    {
      config: { access: { permission: "platform.administer" } },
      schema: { response: { 200: successEnvelope(z.array(adminSessionSummarySchema)) } },
    },
    async (request) => envelope(request, await options.sessions.listAll(requireActor(request))),
  );

  app.post(
    "/admin/sessions/:sessionId/revoke",
    {
      config: { access: { permission: "platform.administer" } },
      schema: { params: sessionIdParamsSchema, response: revoked },
    },
    async (request) =>
      envelope(request, {
        revoked: await options.sessions.revokeAny(requireActor(request), request.params.sessionId),
      }),
  );
};
