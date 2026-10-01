import { toProviderHealth, type ProviderDescriptor, type ProviderHealthStore } from "@sct/providers";
import {
  healthResponseSchema,
  networkIdentitySchema,
  providerHealthListSchema,
  readinessResponseSchema,
  successEnvelope,
  type ReadinessResponse,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { envelope } from "../../platform/envelope";
import type { ClusterVerificationService } from "../application/cluster-verification-service";

export interface SystemRoutesOptions {
  clusterVerification: ClusterVerificationService;
  providers: readonly ProviderDescriptor[];
  primaryRpcProvider: ProviderDescriptor;
  health: ProviderHealthStore;
  pingDatabase: () => Promise<void>;
  pingRedis: () => Promise<void>;
}

async function check(probe: () => Promise<void>): Promise<ReadinessResponse["checks"]["database"]> {
  try {
    await probe();
    return { status: "ok" };
  } catch {
    // Details stay in server logs; readiness output never exposes hostnames or credentials.
    return { status: "failed", message: "Dependency is unreachable" };
  }
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
      const [database, redis] = await Promise.all([check(options.pingDatabase), check(options.pingRedis)]);
      const solanaCluster = options.clusterVerification.isVerified()
        ? ({ status: "ok" } as const)
        : ({ status: "failed", message: "Solana cluster is not verified" } as const);
      const ready = database.status === "ok" && redis.status === "ok" && solanaCluster.status === "ok";
      const body: ReadinessResponse = {
        status: ready ? "ready" : "not_ready",
        checks: { database, redis, solanaCluster },
      };
      return reply.status(ready ? 200 : 503).send(body);
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
    async (request) => {
      const now = new Date();
      const health = await Promise.all(
        options.providers.map(async (descriptor) =>
          toProviderHealth(descriptor, await options.health.read(descriptor.id, now), now),
        ),
      );
      return envelope(request, health);
    },
  );
};
