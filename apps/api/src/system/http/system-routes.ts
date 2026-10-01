import type { ProviderDescriptor, ProviderHealthStore } from "@sct/providers";
import {
  healthResponseSchema,
  networkIdentitySchema,
  providerHealthListSchema,
  readinessResponseSchema,
  successEnvelope,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { envelope } from "../../platform/envelope";
import type { ClusterVerificationService } from "../application/cluster-verification-service";
import { readProviderHealth } from "../application/provider-health-reader";
import { checkReadiness } from "../application/readiness";

export interface SystemRoutesOptions {
  clusterVerification: ClusterVerificationService;
  providers: readonly ProviderDescriptor[];
  primaryRpcProvider: ProviderDescriptor;
  health: ProviderHealthStore;
  pingDatabase: () => Promise<void>;
  pingRedis: () => Promise<void>;
}

export const systemRoutes: FastifyPluginAsyncZod<SystemRoutesOptions> = async (app, options) => {
  app.get(
    "/system/health",
    { config: { access: { public: true } }, schema: { response: { 200: healthResponseSchema } } },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/system/readiness",
    {
      config: { access: { public: true } },
      schema: { response: { 200: readinessResponseSchema, 503: readinessResponseSchema } },
    },
    async (_request, reply) => {
      const body = await checkReadiness({
        pingDatabase: options.pingDatabase,
        pingRedis: options.pingRedis,
        isClusterVerified: () => options.clusterVerification.isVerified(),
      });
      return reply.status(body.status === "ready" ? 200 : 503).send(body);
    },
  );

  app.get(
    "/system/network",
    {
      config: { access: { public: true } },
      schema: { response: { 200: successEnvelope(networkIdentitySchema) } },
    },
    async (request) =>
      envelope(request, options.clusterVerification.identity(options.primaryRpcProvider.displayName)),
  );

  app.get(
    "/system/providers",
    {
      config: { access: { permission: "system.read" } },
      schema: { response: { 200: successEnvelope(providerHealthListSchema) } },
    },
    async (request) => envelope(request, await readProviderHealth(options.providers, options.health)),
  );
};
