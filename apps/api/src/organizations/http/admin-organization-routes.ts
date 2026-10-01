import {
  adminOrganizationSchema,
  adminUserListQuerySchema,
  adminUserSchema,
  roleMatrixSchema,
  sessionRevocationResponseSchema,
  setMembershipStatusRequestSchema,
  setRoleRequestSchema,
  setUserStatusRequestSchema,
  successEnvelope,
  updateOrganizationRequestSchema,
  userIdParamsSchema,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireOrganizationActor } from "../../auth/http/access-control";
import { envelope } from "../../platform/envelope";
import type { MemberAdministration } from "../application/member-administration";
import type { OrganizationAdministration } from "../application/organization-administration";

const access = { access: { permission: "platform.administer" as const } };

/** SPEC-026 — owner console: members, organization, roles. */
export const adminOrganizationRoutes: FastifyPluginAsyncZod<{
  members: MemberAdministration;
  organization: OrganizationAdministration;
}> = async (app, options) => {
  const userResponse = { 200: successEnvelope(adminUserSchema) };

  app.get(
    "/admin/users",
    {
      config: access,
      schema: {
        querystring: adminUserListQuerySchema,
        response: { 200: successEnvelope(z.array(adminUserSchema)) },
      },
    },
    async (request) => {
      const users = await options.members.list(requireOrganizationActor(request), request.query);
      const last = users.at(-1);
      return envelope(request, users, {
        nextCursor: users.length === request.query.limit && last ? last.id : null,
      });
    },
  );

  app.put(
    "/admin/users/:userId/role",
    {
      config: access,
      schema: { params: userIdParamsSchema, body: setRoleRequestSchema, response: userResponse },
    },
    async (request) =>
      envelope(
        request,
        await options.members.setRole(
          requireOrganizationActor(request),
          request.params.userId,
          request.body.roleKey,
        ),
      ),
  );

  app.put(
    "/admin/users/:userId/membership",
    {
      config: access,
      schema: { params: userIdParamsSchema, body: setMembershipStatusRequestSchema, response: userResponse },
    },
    async (request) =>
      envelope(
        request,
        await options.members.setMembershipStatus(
          requireOrganizationActor(request),
          request.params.userId,
          request.body.status,
        ),
      ),
  );

  app.put(
    "/admin/users/:userId/status",
    {
      config: access,
      schema: { params: userIdParamsSchema, body: setUserStatusRequestSchema, response: userResponse },
    },
    async (request) =>
      envelope(
        request,
        await options.members.setUserStatus(
          requireOrganizationActor(request),
          request.params.userId,
          request.body.status,
        ),
      ),
  );

  app.post(
    "/admin/users/:userId/sessions/revoke",
    {
      config: access,
      schema: {
        params: userIdParamsSchema,
        response: { 200: successEnvelope(sessionRevocationResponseSchema) },
      },
    },
    async (request) =>
      envelope(request, {
        revoked: await options.members.revokeSessions(
          requireOrganizationActor(request),
          request.params.userId,
        ),
      }),
  );

  app.get(
    "/admin/organization",
    { config: access, schema: { response: { 200: successEnvelope(adminOrganizationSchema) } } },
    async (request) => envelope(request, await options.organization.get(requireOrganizationActor(request))),
  );

  app.patch(
    "/admin/organization",
    {
      config: access,
      schema: {
        body: updateOrganizationRequestSchema,
        response: { 200: successEnvelope(adminOrganizationSchema) },
      },
    },
    async (request) =>
      envelope(
        request,
        await options.organization.rename(requireOrganizationActor(request), request.body.name),
      ),
  );

  app.get(
    "/admin/roles",
    { config: access, schema: { response: { 200: successEnvelope(roleMatrixSchema) } } },
    async (request) =>
      envelope(request, await options.organization.roleMatrix(requireOrganizationActor(request))),
  );
};
