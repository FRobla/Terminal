import { createHash } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { resolveRequestId } from "@sct/observability";
import Fastify, { LogController, type FastifyBaseLogger } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { announcementRoutes } from "./announcements/http/announcement-routes";
import { auditRoutes } from "./audit/http/audit-routes";
import { registerAccessControl } from "./auth/http/access-control";
import { authRoutes } from "./auth/http/auth-routes";
import { sessionRoutes } from "./auth/http/session-routes";
import { developerRoutes } from "./developer/http/developer-routes";
import { adminOrganizationRoutes } from "./organizations/http/admin-organization-routes";
import { registerErrorHandling } from "./platform/error-handler";
import { registerRequestContext } from "./platform/request-context";
import type { ApiServices } from "./services";
import { adminSystemRoutes } from "./system/http/admin-system-routes";
import { systemRoutes } from "./system/http/system-routes";
import { meRoutes } from "./users/http/me-routes";
import { walletRoutes } from "./wallets/http/wallet-routes";

export const API_PREFIX = "/api/v1";

export interface ServerOptions {
  /** Global per-client request budget (SECURITY.md §8). */
  rateLimit?: { max: number; timeWindowMs: number };
  authRateLimit?: { max: number; timeWindowMs: number };
}

export async function buildServer(services: ApiServices, options: ServerOptions = {}) {
  const app = Fastify({
    loggerInstance: services.logger as FastifyBaseLogger,
    // Request completion is logged once by the request-context hook (FND-AC-04).
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (request) => resolveRequestId(request.headers["x-request-id"]),
    // The terminal reaches the API through the local Next.js rewrite proxy.
    trustProxy: "loopback",
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerRequestContext(app);
  registerErrorHandling(app);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  await app.register(cookie);

  const global = options.rateLimit ?? { max: 300, timeWindowMs: 60_000 };
  await app.register(rateLimit, {
    global: true,
    max: global.max,
    timeWindow: global.timeWindowMs,
    redis: services.redis,
    nameSpace: "sct:api-ratelimit:",
    keyGenerator: (request) => {
      const token = request.cookies[services.cookie.name];
      return token ? `session:${createHash("sha256").update(token).digest("hex")}` : `ip:${request.ip}`;
    },
  });

  // OWN-AC-16: every route is recorded with its declared access as it registers.
  app.addHook("onRoute", (route) =>
    services.routeCatalog.record(route.method, route.url, route.config?.access),
  );

  registerAccessControl(app, {
    sessions: services.sessions,
    audit: services.audit,
    cookieName: services.cookie.name,
    publicAppOrigin: services.config.PUBLIC_APP_ORIGIN,
    csrfSecret: services.csrfSecret,
  });

  const exposeOpenApi = services.config.APP_ENV !== "production";
  if (exposeOpenApi) {
    await app.register(swagger, {
      openapi: { info: { title: "Solana Corporate Terminal API", version: "1.0.0" } },
      transform: jsonSchemaTransform,
    });
  }

  const auth = options.authRateLimit ?? { max: 20, timeWindowMs: 60_000 };
  await app.register(
    async (api) => {
      await api.register(systemRoutes, {
        clusterVerification: services.clusterVerification,
        providers: services.providers,
        primaryRpcProvider: services.primaryRpcProvider,
        health: services.health,
        pingDatabase: services.database.ping,
        pingRedis: services.pingRedis,
      });
      await api.register(authRoutes, {
        signIn: services.signIn,
        sessions: services.sessions,
        audit: services.audit,
        cookie: services.cookie,
        authRateLimit: { max: auth.max, timeWindow: auth.timeWindowMs },
      });
      await api.register(walletRoutes, {
        cluster: services.config.SOLANA_CLUSTER,
        getWalletOverview: services.getWalletOverview,
        isClusterVerified: () => services.clusterVerification.isVerified(),
        audit: services.audit,
      });
      await api.register(auditRoutes, { reader: services.auditRepository });
      await api.register(meRoutes, { profiles: services.profiles, preferences: services.preferences });
      await api.register(sessionRoutes, { sessions: services.sessionAdministration });
      await api.register(announcementRoutes, { announcements: services.announcements });
      await api.register(adminOrganizationRoutes, {
        members: services.memberAdministration,
        organization: services.organizationAdministration,
      });
      await api.register(adminSystemRoutes, {
        overview: services.platformOverview,
        runtime: services.runtimeInspection,
        administration: services.systemAdministration,
        providerHistory: services.providerHistory,
        providerHealthQueue: services.providerHealthQueue,
      });
      await api.register(developerRoutes, {
        catalog: services.routeCatalog,
        caches: services.cacheMaintenance,
      });

      if (exposeOpenApi) {
        api.get("/openapi.json", { config: { access: { public: true } }, schema: { hide: true } }, async () =>
          app.swagger(),
        );
      }
    },
    { prefix: API_PREFIX },
  );

  return app;
}
