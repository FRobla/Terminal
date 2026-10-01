import {
  cachePurgeRequestSchema,
  cachePurgeResponseSchema,
  routeCatalogSchema,
  successEnvelope,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireActor } from "../../auth/http/access-control";
import { envelope } from "../../platform/envelope";
import type { CacheMaintenance } from "../application/cache-maintenance";
import type { RouteCatalog } from "../application/route-catalog";

const access = { permission: "platform.administer" as const };

/** SPEC-026 OWN-AC-16 — developer tooling for the owner. */
export const developerRoutes: FastifyPluginAsyncZod<{
  catalog: RouteCatalog;
  caches: CacheMaintenance;
}> = async (app, options) => {
  app.get(
    "/admin/developer/routes",
    { config: { access }, schema: { response: { 200: successEnvelope(routeCatalogSchema) } } },
    async (request) => envelope(request, options.catalog.list()),
  );

  app.post(
    "/admin/developer/cache/purge",
    {
      config: { access },
      schema: { body: cachePurgeRequestSchema, response: { 200: successEnvelope(cachePurgeResponseSchema) } },
    },
    async (request) =>
      envelope(request, await options.caches.purge(requireActor(request), request.body.target)),
  );
};
