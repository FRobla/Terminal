import { parseAddress } from "@sct/solana";
import {
  assignWalletRequestSchema,
  managedWalletSchema,
  organizationMembersSchema,
  ownershipChallengeRequestSchema,
  ownershipChallengeResponseSchema,
  registerWalletRequestSchema,
  successEnvelope,
  updateWalletRequestSchema,
  walletAssignmentParamsSchema,
  walletHistoryQuerySchema,
  walletHistorySchema,
  walletIdParamsSchema,
  walletListQuerySchema,
  walletListSchema,
  walletExportResponseSchema,
  walletSyncResponseSchema,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireOrganizationActor } from "../../auth/http/access-control";
import { ApiError } from "../../platform/api-error";
import { envelope } from "../../platform/envelope";
import type { AssignmentFailure, WalletAssignments } from "../application/wallet-assignments";
import type { UpdateFailure, WalletDirectory } from "../application/wallet-directory";
import type { WalletExports } from "../application/wallet-exports";
import type { WalletHistoryService } from "../application/wallet-history";
import type { RegistrationFailure, WalletRegistration } from "../application/wallet-registration";

export interface WalletRegistryRoutesOptions {
  registration: WalletRegistration;
  directory: WalletDirectory;
  assignments: WalletAssignments;
  history: WalletHistoryService;
  exports: WalletExports;
  isClusterVerified: () => boolean;
}

function registrationError(failure: RegistrationFailure): ApiError {
  switch (failure.code) {
    case "WALLET_OWNERSHIP_UNVERIFIED":
      return new ApiError(failure.code, { details: { reason: failure.reason } });
    case "WALLET_ALREADY_REGISTERED":
      return new ApiError(failure.code);
    default:
      return new ApiError(failure.code, { message: failure.message });
  }
}

function mutationError(failure: UpdateFailure | AssignmentFailure): ApiError {
  return failure.code === "WALLET_NOT_FOUND"
    ? new ApiError(failure.code)
    : new ApiError(failure.code, { message: failure.message });
}

/** SPEC-009 — wallet registry, assignments, and indexed history. */
export const walletRegistryRoutes: FastifyPluginAsyncZod<WalletRegistryRoutesOptions> = async (
  app,
  options,
) => {
  const walletResponse = { 200: successEnvelope(managedWalletSchema) };

  app.post(
    "/wallets/ownership-challenges",
    {
      config: { access: { permission: "wallet.create" } },
      schema: {
        body: ownershipChallengeRequestSchema,
        response: { 200: successEnvelope(ownershipChallengeResponseSchema) },
      },
    },
    async (request) => {
      if (!parseAddress(request.body.address)) throw new ApiError("WALLET_ADDRESS_INVALID");
      return envelope(
        request,
        await options.registration.issueChallenge(requireOrganizationActor(request), request.body.address),
      );
    },
  );

  app.post(
    "/wallets",
    {
      config: { access: { permission: "wallet.create" } },
      schema: { body: registerWalletRequestSchema, response: walletResponse },
    },
    async (request) => {
      if (!parseAddress(request.body.address)) throw new ApiError("WALLET_ADDRESS_INVALID");
      const result = await options.registration.register(requireOrganizationActor(request), request.body);
      if (!result.ok) throw registrationError(result.failure);
      return envelope(request, result.wallet);
    },
  );

  app.get(
    "/wallets",
    {
      config: { access: { permission: "wallet.read" } },
      schema: { querystring: walletListQuerySchema, response: { 200: successEnvelope(walletListSchema) } },
    },
    async (request, reply) => {
      const actor = requireOrganizationActor(request);
      const { list, nextCursor } = await options.directory.list(actor, request.query, {
        requestId: request.id,
      });
      reply.header("cache-control", "no-store");
      return envelope(request, list, { nextCursor });
    },
  );

  app.get(
    "/wallets/:walletId",
    {
      config: { access: { permission: "wallet.read" } },
      schema: { params: walletIdParamsSchema, response: walletResponse },
    },
    async (request) => {
      const wallet = await options.directory.get(requireOrganizationActor(request), request.params.walletId);
      if (!wallet) throw new ApiError("WALLET_NOT_FOUND");
      return envelope(request, wallet);
    },
  );

  app.patch(
    "/wallets/:walletId",
    {
      config: { access: { permission: "wallet.create" } },
      schema: { params: walletIdParamsSchema, body: updateWalletRequestSchema, response: walletResponse },
    },
    async (request) => {
      const result = await options.directory.update(
        requireOrganizationActor(request),
        request.params.walletId,
        request.body,
      );
      if (!result.ok) throw mutationError(result.failure);
      return envelope(request, result.wallet);
    },
  );

  app.get(
    "/organization/members",
    {
      config: { access: { permission: "organization.manage" } },
      schema: { response: { 200: successEnvelope(organizationMembersSchema) } },
    },
    async (request) =>
      envelope(request, await options.assignments.members(requireOrganizationActor(request))),
  );

  app.post(
    "/wallets/:walletId/assignments",
    {
      config: { access: { permission: "organization.manage" } },
      schema: { params: walletIdParamsSchema, body: assignWalletRequestSchema, response: walletResponse },
    },
    async (request) => {
      const result = await options.assignments.assign(
        requireOrganizationActor(request),
        request.params.walletId,
        request.body.userId,
        request.body.role,
      );
      if (!result.ok) throw mutationError(result.failure);
      return envelope(request, result.wallet);
    },
  );

  app.delete(
    "/wallets/:walletId/assignments/:userId/:role",
    {
      config: { access: { permission: "organization.manage" } },
      schema: { params: walletAssignmentParamsSchema, response: walletResponse },
    },
    async (request) => {
      const result = await options.assignments.unassign(
        requireOrganizationActor(request),
        request.params.walletId,
        request.params.userId,
        request.params.role,
      );
      if (!result.ok) throw mutationError(result.failure);
      return envelope(request, result.wallet);
    },
  );

  app.get(
    "/wallets/:walletId/transactions",
    {
      config: { access: { permission: "wallet.read" } },
      schema: {
        params: walletIdParamsSchema,
        querystring: walletHistoryQuerySchema,
        response: { 200: successEnvelope(walletHistorySchema) },
      },
    },
    async (request) => {
      const result = await options.history.history(
        requireOrganizationActor(request),
        request.params.walletId,
        request.query,
      );
      if (!result) throw new ApiError("WALLET_NOT_FOUND");
      return envelope(request, result.history, { nextCursor: result.nextCursor });
    },
  );

  app.post(
    "/wallets/:walletId/sync",
    {
      config: { access: { permission: "wallet.read" } },
      schema: { params: walletIdParamsSchema, response: { 200: successEnvelope(walletSyncResponseSchema) } },
    },
    async (request) => {
      if (!options.isClusterVerified()) throw new ApiError("CLUSTER_VERIFICATION_FAILED");
      const result = await options.history.requestSync(
        requireOrganizationActor(request),
        request.params.walletId,
      );
      if (!result) throw new ApiError("WALLET_NOT_FOUND");
      return envelope(request, result);
    },
  );

  app.post(
    "/wallets/:walletId/exports",
    {
      config: { access: { permission: "wallet.export" } },
      schema: {
        params: walletIdParamsSchema,
        response: { 200: successEnvelope(walletExportResponseSchema) },
      },
    },
    async (request) => {
      const result = await options.exports.record(requireOrganizationActor(request), request.params.walletId);
      if (!result.ok) {
        throw result.failure.code === "WALLET_NOT_FOUND"
          ? new ApiError("WALLET_NOT_FOUND")
          : new ApiError(result.failure.code, { message: result.failure.message });
      }
      return envelope(request, { recordedAt: result.recordedAt });
    },
  );
};
