import { WALLET_STANDARD_CHAINS, type PermittedCluster } from "@sct/network";
import { parseAddress } from "@sct/solana";
import {
  successEnvelope,
  walletAddressParamsSchema,
  walletConnectionRequestSchema,
  walletConnectionResponseSchema,
  walletOverviewQuerySchema,
  walletOverviewSchema,
} from "@sct/validation";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AuditLog } from "@sct/audit";
import { clientMetadata, requireSession } from "../../auth/http/access-control";
import { ApiError } from "../../platform/api-error";
import { envelope } from "../../platform/envelope";
import type { GetWalletOverview } from "../application/get-wallet-overview";

export interface WalletRoutesOptions {
  cluster: PermittedCluster;
  getWalletOverview: GetWalletOverview;
  isClusterVerified: () => boolean;
  audit: AuditLog;
}

export const walletRoutes: FastifyPluginAsyncZod<WalletRoutesOptions> = async (app, options) => {
  app.get(
    "/wallets/:address/overview",
    {
      config: { access: { permission: "wallet.read" } },
      schema: {
        params: walletAddressParamsSchema,
        querystring: walletOverviewQuerySchema,
        response: { 200: successEnvelope(walletOverviewSchema) },
      },
    },
    async (request, reply) => {
      const address = parseAddress(request.params.address);
      if (!address) throw new ApiError("WALLET_ADDRESS_INVALID");
      if (!options.isClusterVerified()) throw new ApiError("CLUSTER_VERIFICATION_FAILED");
      const overview = await options.getWalletOverview.execute(address, request.query.signaturesLimit, {
        requestId: request.id,
      });
      reply.header("cache-control", "no-store");
      return envelope(request, overview);
    },
  );

  app.post(
    "/wallets/connections",
    {
      config: { access: { session: true } },
      schema: {
        body: walletConnectionRequestSchema,
        response: { 200: successEnvelope(walletConnectionResponseSchema) },
      },
    },
    async (request) => {
      const session = requireSession(request);
      if (!parseAddress(request.body.address)) throw new ApiError("WALLET_ADDRESS_INVALID");
      const expectedChain = WALLET_STANDARD_CHAINS[options.cluster];
      const accepted = request.body.walletChains.includes(expectedChain);
      const common = {
        resourceType: "wallet",
        resourceId: request.body.address,
        actorType: "user" as const,
        actorId: session.userId,
        organizationId: session.organization?.id ?? null,
        cluster: options.cluster,
        ...clientMetadata(request),
      };
      const metadata = {
        address: request.body.address,
        walletName: request.body.walletName,
        walletChains: request.body.walletChains,
      };
      if (accepted) {
        await options.audit.record({ ...common, action: "wallet.connected", result: "success", metadata });
      } else {
        await options.audit.record({
          ...common,
          action: "wallet.connection_rejected",
          result: "failure",
          metadata: { ...metadata, reason: "CLUSTER_MISMATCH" },
        });
      }
      return envelope(request, {
        accepted,
        reason: accepted ? null : ("CLUSTER_MISMATCH" as const),
        recordedAt: new Date().toISOString(),
      });
    },
  );
};
