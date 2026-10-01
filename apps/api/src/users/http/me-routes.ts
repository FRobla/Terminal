import {
  profileSchema,
  successEnvelope,
  updateProfileRequestSchema,
  userPreferencesSchema,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireActor, requireSession } from "../../auth/http/access-control";
import { envelope } from "../../platform/envelope";
import type { PreferenceService } from "../application/preference-service";
import type { ProfileService } from "../application/profile-service";

/** SPEC-025 — the caller's profile and preferences. Every route acts on the session's own user. */
export const meRoutes: FastifyPluginAsyncZod<{
  profiles: ProfileService;
  preferences: PreferenceService;
}> = async (app, options) => {
  const profileResponse = { 200: successEnvelope(profileSchema) };

  const loadProfile = (request: Parameters<typeof requireSession>[0]) => {
    const session = requireSession(request);
    return options.profiles.get(requireActor(request), session.organization, session.permissions);
  };

  app.get(
    "/me/profile",
    { config: { access: { session: true } }, schema: { response: profileResponse } },
    async (request) => envelope(request, await loadProfile(request)),
  );

  app.patch(
    "/me/profile",
    {
      config: { access: { session: true } },
      schema: { body: updateProfileRequestSchema, response: profileResponse },
    },
    async (request) => {
      await options.profiles.updateDisplayName(requireActor(request), request.body.displayName);
      return envelope(request, await loadProfile(request));
    },
  );

  app.get(
    "/me/preferences",
    {
      config: { access: { session: true } },
      schema: { response: { 200: successEnvelope(userPreferencesSchema) } },
    },
    async (request) => envelope(request, await options.preferences.get(requireSession(request).userId)),
  );

  app.put(
    "/me/preferences",
    {
      config: { access: { session: true } },
      schema: { body: userPreferencesSchema, response: { 200: successEnvelope(userPreferencesSchema) } },
    },
    async (request) =>
      envelope(request, await options.preferences.replace(requireSession(request).userId, request.body)),
  );
};
