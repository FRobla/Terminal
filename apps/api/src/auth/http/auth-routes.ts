import { parseAddress } from "@sct/solana";
import {
  errorResponseSchema,
  sessionResponseSchema,
  siwsChallengeRequestSchema,
  siwsChallengeResponseSchema,
  siwsVerifyRequestSchema,
  successEnvelope,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuditLog } from "@sct/audit";
import { ApiError } from "../../platform/api-error";
import { envelope } from "../../platform/envelope";
import type { SessionService } from "../application/session-service";
import type { SignInService } from "../application/sign-in-service";
import { clientMetadata, requireSession } from "./access-control";
import type { CookieSerializeOptions } from "@fastify/cookie";

export interface AuthRoutesOptions {
  signIn: SignInService;
  sessions: SessionService;
  audit: AuditLog;
  cookie: { name: string; options: CookieSerializeOptions };
  authRateLimit: { max: number; timeWindow: number };
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const rateLimit = options.authRateLimit;

  app.post(
    "/auth/siws/challenge",
    {
      config: { access: { public: true }, rateLimit },
      schema: {
        body: siwsChallengeRequestSchema,
        response: { 200: successEnvelope(siwsChallengeResponseSchema), 400: errorResponseSchema },
      },
    },
    async (request) => {
      if (!parseAddress(request.body.address)) throw new ApiError("WALLET_ADDRESS_INVALID");
      const challenge = await options.signIn.issueChallenge(request.body.address, clientMetadata(request));
      return envelope(request, challenge);
    },
  );

  app.post(
    "/auth/siws/verify",
    {
      config: { access: { public: true }, rateLimit },
      schema: {
        body: siwsVerifyRequestSchema,
        response: { 200: successEnvelope(z.object({ expiresAt: z.string() })) },
      },
    },
    async (request, reply) => {
      if (!parseAddress(request.body.address)) throw new ApiError("WALLET_ADDRESS_INVALID");
      const result = await options.signIn.verify(
        {
          challengeId: request.body.challengeId,
          address: request.body.address,
          signedMessage: Buffer.from(request.body.signedMessage, "base64"),
          signature: Buffer.from(request.body.signature, "base64"),
          method: request.body.method,
        },
        clientMetadata(request),
      );
      if (!result.ok) throw new ApiError(result.code);
      reply.setCookie(options.cookie.name, result.sessionToken, {
        ...options.cookie.options,
        expires: result.expiresAt,
      });
      return envelope(request, { expiresAt: result.expiresAt.toISOString() });
    },
  );

  app.get(
    "/auth/session",
    {
      config: { access: { session: true } },
      schema: { response: { 200: successEnvelope(sessionResponseSchema) } },
    },
    async (request) => {
      const session = requireSession(request);
      return envelope(request, {
        user: { id: session.userId, displayName: session.displayName },
        walletAddress: session.walletAddress,
        organization: session.organization,
        permissions: [...session.permissions].sort(),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  );

  app.post(
    "/auth/logout",
    {
      config: { access: { session: true } },
      schema: { response: { 200: successEnvelope(z.object({ loggedOut: z.literal(true) })) } },
    },
    async (request, reply) => {
      const session = requireSession(request);
      await options.sessions.revoke(session.sessionId);
      await options.audit.record({
        action: "user.logout",
        resourceType: "session",
        resourceId: session.sessionId,
        result: "success",
        actorType: "user",
        actorId: session.userId,
        organizationId: session.organization?.id ?? null,
        ...clientMetadata(request),
        metadata: {},
      });
      reply.clearCookie(options.cookie.name, options.cookie.options);
      return envelope(request, { loggedOut: true as const });
    },
  );
};
