import { updateRequestContext } from "@sct/observability";
import type { Permission } from "@sct/validation";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuditLog } from "../../audit/application/audit-log";
import { ApiError } from "../../platform/api-error";
import type { Actor } from "../application/actor";
import type { AuthenticatedSession, SessionService } from "../application/session-service";
import { isValidCsrfToken } from "../domain/session-token";

/**
 * Every route must declare its access requirement (RBAC-AC-01):
 * - `public`: no session required
 * - `session`: any authenticated session
 * - `permission`: authenticated session holding the permission in the active organization
 */
export type RouteAccess = { public: true } | { session: true } | { permission: Permission };

declare module "fastify" {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    auth: AuthenticatedSession | null;
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AccessControlOptions {
  sessions: SessionService;
  audit: AuditLog;
  cookieName: string;
  publicAppOrigin: string;
  csrfSecret: Buffer;
}

export function clientMetadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return { ipAddress: request.ip ?? null, userAgent: typeof userAgent === "string" ? userAgent : null };
}

/** The browser origin must be ours for state-changing requests (SECURITY.md §8). */
function hasTrustedOrigin(request: FastifyRequest, publicAppOrigin: string): boolean {
  const origin = request.headers.origin;
  if (typeof origin === "string") return origin === new URL(publicAppOrigin).origin;
  return request.headers["sec-fetch-site"] === "same-origin";
}

export function registerAccessControl(app: FastifyInstance, options: AccessControlOptions): void {
  app.decorateRequest("auth", null);

  app.addHook("onRoute", (route) => {
    if (!route.config?.access) {
      throw new Error(`Route ${String(route.method)} ${route.url} does not declare an access requirement.`);
    }
  });

  app.addHook("preValidation", async (request) => {
    // Unmatched routes fall through to the not-found handler.
    if (request.is404) return;
    const access = request.routeOptions.config.access;
    if (!access) throw new ApiError("FORBIDDEN");

    const resolution = await options.sessions.resolve(request.cookies[options.cookieName]);
    request.auth = resolution.status === "authenticated" ? resolution.session : null;
    if (request.auth) {
      updateRequestContext({
        userId: request.auth.userId,
        ...(request.auth.organization ? { organizationId: request.auth.organization.id } : {}),
      });
      request.requestContext.userId = request.auth.userId;
      if (request.auth.organization) request.requestContext.organizationId = request.auth.organization.id;
    }

    const unsafe = UNSAFE_METHODS.has(request.method);
    if (unsafe && !hasTrustedOrigin(request, options.publicAppOrigin)) {
      throw new ApiError("CSRF_TOKEN_INVALID");
    }
    if ("public" in access) return;

    if (!request.auth) {
      throw new ApiError(resolution.status === "expired" ? "SESSION_EXPIRED" : "UNAUTHENTICATED");
    }

    if (unsafe) {
      const token = request.headers["x-csrf-token"];
      if (
        !isValidCsrfToken(
          typeof token === "string" ? token : undefined,
          request.auth.sessionId,
          options.csrfSecret,
        )
      ) {
        throw new ApiError("CSRF_TOKEN_INVALID");
      }
    }

    if ("permission" in access && !request.auth.permissions.has(access.permission)) {
      await options.audit.record({
        action: "authorization.denied",
        resourceType: "route",
        resourceId: request.routeOptions.url ?? null,
        result: "denied",
        actorType: "user",
        actorId: request.auth.userId,
        organizationId: request.auth.organization?.id ?? null,
        ...clientMetadata(request),
        metadata: {
          requiredPermission: access.permission,
          route: `${request.method} ${request.routeOptions.url}`,
        },
      });
      throw new ApiError("FORBIDDEN");
    }
  });
}

/** Narrowing helper for handlers of non-public routes. */
export function requireSession(request: FastifyRequest): AuthenticatedSession {
  if (!request.auth) throw new ApiError("UNAUTHENTICATED");
  return request.auth;
}

/** The authenticated caller with client metadata, for application services that audit. */
export function requireActor(request: FastifyRequest): Actor {
  const session = requireSession(request);
  return {
    userId: session.userId,
    sessionId: session.sessionId,
    organizationId: session.organization?.id ?? null,
    ...clientMetadata(request),
  };
}

/** Like `requireActor`, for operations scoped to the active organization. */
export function requireOrganizationActor(request: FastifyRequest): Actor & { organizationId: string } {
  const actor = requireActor(request);
  if (!actor.organizationId) throw new ApiError("FORBIDDEN");
  return { ...actor, organizationId: actor.organizationId };
}
