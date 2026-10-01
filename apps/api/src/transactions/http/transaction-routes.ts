import {
  signingFailedRequestSchema,
  signingRequestSchema,
  solTransferRequestSchema,
  submitTransactionRequestSchema,
  successEnvelope,
  transactionIdParamsSchema,
  transactionListQuerySchema,
  transactionRecordSchema,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireOrganizationActor } from "../../auth/http/access-control";
import { ApiError } from "../../platform/api-error";
import { envelope } from "../../platform/envelope";
import type { PrepareFailure, SolTransferService } from "../application/sol-transfer-service";
import type { TransactionQueries } from "../application/transaction-queries";
import type { SigningFailure, TransactionSigning } from "../application/transaction-signing";

export interface TransactionRoutesOptions {
  transfers: SolTransferService;
  signing: TransactionSigning;
  queries: TransactionQueries;
  isClusterVerified: () => boolean;
}

function toApiError(failure: PrepareFailure | SigningFailure): ApiError {
  switch (failure.code) {
    case "WALLET_NOT_FOUND":
    case "TRANSACTION_NOT_FOUND":
    case "IDEMPOTENCY_CONFLICT":
      return new ApiError(failure.code);
    case "TRANSACTION_MESSAGE_MISMATCH":
      return new ApiError(failure.code, {
        ...(failure.reason === "SIGNATURE_INVALID"
          ? { message: "The fee payer's signature does not verify. Nothing was sent." }
          : {}),
        details: { reason: failure.reason },
      });
    default:
      return new ApiError(failure.code, { message: failure.message });
  }
}

/** SPEC-004 — SOL transfer preparation, signing hand-off, submission, and queries. */
export const transactionRoutes: FastifyPluginAsyncZod<TransactionRoutesOptions> = async (app, options) => {
  const recordResponse = { 200: successEnvelope(transactionRecordSchema) };
  const control = { access: { permission: "wallet.control" as const } };
  const requireVerifiedCluster = () => {
    if (!options.isClusterVerified()) throw new ApiError("CLUSTER_VERIFICATION_FAILED");
  };

  app.post(
    "/transactions/sol-transfers",
    { config: control, schema: { body: solTransferRequestSchema, response: recordResponse } },
    async (request) => {
      requireVerifiedCluster();
      const result = await options.transfers.prepare(requireOrganizationActor(request), request.body, {
        requestId: request.id,
      });
      if (!result.ok) throw toApiError(result.failure);
      return envelope(request, await options.queries.view(result.record));
    },
  );

  app.post(
    "/transactions/:transactionId/cancel",
    { config: control, schema: { params: transactionIdParamsSchema, response: recordResponse } },
    async (request) => {
      const result = await options.signing.cancel(
        requireOrganizationActor(request),
        request.params.transactionId,
      );
      if (!result.ok) throw toApiError(result.failure);
      return envelope(request, await options.queries.view(result.record));
    },
  );

  app.post(
    "/transactions/:transactionId/signing",
    {
      config: control,
      schema: { params: transactionIdParamsSchema, body: signingRequestSchema, response: recordResponse },
    },
    async (request) => {
      const result = await options.signing.requestSignature(
        requireOrganizationActor(request),
        request.params.transactionId,
        request.body.acknowledgeUnknownPrograms,
      );
      if (!result.ok) throw toApiError(result.failure);
      return envelope(request, await options.queries.view(result.record));
    },
  );

  app.post(
    "/transactions/:transactionId/signing-failed",
    {
      config: control,
      schema: {
        params: transactionIdParamsSchema,
        body: signingFailedRequestSchema,
        response: recordResponse,
      },
    },
    async (request) => {
      const result = await options.signing.signingFailed(
        requireOrganizationActor(request),
        request.params.transactionId,
        request.body.reason,
      );
      if (!result.ok) throw toApiError(result.failure);
      return envelope(request, await options.queries.view(result.record));
    },
  );

  app.post(
    "/transactions/:transactionId/submit",
    {
      config: control,
      schema: {
        params: transactionIdParamsSchema,
        body: submitTransactionRequestSchema,
        response: recordResponse,
      },
    },
    async (request) => {
      requireVerifiedCluster();
      const result = await options.signing.submit(
        requireOrganizationActor(request),
        request.params.transactionId,
        request.body.signedTransactionBase64,
      );
      if (!result.ok) throw toApiError(result.failure);
      return envelope(request, await options.queries.view(result.record));
    },
  );

  app.get(
    "/transactions",
    {
      config: { access: { permission: "wallet.read" } },
      schema: {
        querystring: transactionListQuerySchema,
        response: { 200: successEnvelope(z.array(transactionRecordSchema)) },
      },
    },
    async (request, reply) => {
      const { transactions, nextCursor } = await options.queries.list(
        requireOrganizationActor(request),
        request.query,
      );
      reply.header("cache-control", "no-store");
      return envelope(request, transactions, { nextCursor });
    },
  );

  app.get(
    "/transactions/:transactionId",
    {
      config: { access: { permission: "wallet.read" } },
      schema: { params: transactionIdParamsSchema, response: recordResponse },
    },
    async (request, reply) => {
      const view = await options.queries.get(requireOrganizationActor(request), request.params.transactionId);
      if (!view) throw new ApiError("TRANSACTION_NOT_FOUND");
      reply.header("cache-control", "no-store");
      return envelope(request, view);
    },
  );
};
