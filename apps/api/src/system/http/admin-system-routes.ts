import {
  adminOverviewSchema,
  enqueuedJobSchema,
  jobsOverviewSchema,
  networkIdentitySchema,
  providerHealthSnapshotSchema,
  providerHistoryQuerySchema,
  runtimeInspectionSchema,
  successEnvelope,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireActor, requireOrganizationActor } from "../../auth/http/access-control";
import { envelope } from "../../platform/envelope";
import type { ProviderHistoryReader, QueueInspector } from "../application/console-ports";
import type { PlatformOverview } from "../application/platform-overview";
import type { RuntimeInspection } from "../application/runtime-inspection";
import type { SystemAdministration } from "../application/system-administration";

const access = { permission: "platform.administer" as const };

/** Calls that reach the Solana RPC are limited per client (SPEC-026 §6). */
const RPC_ACTION_RATE_LIMIT = { max: 6, timeWindow: 60_000 };

export interface AdminSystemRoutesOptions {
  overview: PlatformOverview;
  runtime: RuntimeInspection;
  administration: SystemAdministration;
  providerHistory: ProviderHistoryReader;
  providerHealthQueue: QueueInspector;
}

/** SPEC-026 — owner console: overview, runtime, cluster, providers, jobs. */
export const adminSystemRoutes: FastifyPluginAsyncZod<AdminSystemRoutesOptions> = async (app, options) => {
  app.get(
    "/admin/overview",
    { config: { access }, schema: { response: { 200: successEnvelope(adminOverviewSchema) } } },
    async (request) =>
      envelope(request, await options.overview.read(requireOrganizationActor(request).organizationId)),
  );

  app.get(
    "/admin/system/runtime",
    { config: { access }, schema: { response: { 200: successEnvelope(runtimeInspectionSchema) } } },
    async (request) => envelope(request, await options.runtime.inspect()),
  );

  app.post(
    "/admin/system/cluster/verify",
    {
      config: { access, rateLimit: RPC_ACTION_RATE_LIMIT },
      schema: { response: { 200: successEnvelope(networkIdentitySchema) } },
    },
    async (request) => envelope(request, await options.administration.verifyCluster(requireActor(request))),
  );

  app.get(
    "/admin/system/provider-history",
    {
      config: { access },
      schema: {
        querystring: providerHistoryQuerySchema,
        response: { 200: successEnvelope(z.array(providerHealthSnapshotSchema)) },
      },
    },
    async (request) => envelope(request, await options.providerHistory.list(request.query)),
  );

  app.get(
    "/admin/jobs",
    { config: { access }, schema: { response: { 200: successEnvelope(jobsOverviewSchema) } } },
    async (request) => envelope(request, { queues: await options.administration.queues() }),
  );

  app.post(
    "/admin/jobs/provider-health/run",
    {
      config: { access, rateLimit: RPC_ACTION_RATE_LIMIT },
      schema: { response: { 200: successEnvelope(enqueuedJobSchema) } },
    },
    async (request) =>
      envelope(
        request,
        await options.administration.runProviderHealthProbe(
          requireActor(request),
          options.providerHealthQueue,
        ),
      ),
  );
};
