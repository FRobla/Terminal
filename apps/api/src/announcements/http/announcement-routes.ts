import { announcementInputSchema, currentAnnouncementSchema, successEnvelope } from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireActor } from "../../auth/http/access-control";
import { envelope } from "../../platform/envelope";
import type { AnnouncementService } from "../application/announcement-service";

/** SPEC-026 OWN-AC-11 */
export const announcementRoutes: FastifyPluginAsyncZod<{ announcements: AnnouncementService }> = async (
  app,
  options,
) => {
  const response = { 200: successEnvelope(currentAnnouncementSchema) };

  app.get(
    "/announcements/current",
    { config: { access: { session: true } }, schema: { response } },
    async (request) => envelope(request, await options.announcements.current()),
  );

  app.put(
    "/admin/announcement",
    {
      config: { access: { permission: "platform.administer" } },
      schema: { body: announcementInputSchema, response },
    },
    async (request) =>
      envelope(request, await options.announcements.update(requireActor(request), request.body)),
  );
};
