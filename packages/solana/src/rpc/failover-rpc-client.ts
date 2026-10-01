import { isProviderError } from "@sct/providers";
import type { Cluster } from "@sct/network";
import type { Provenance } from "@sct/validation";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { isFailoverEligible } from "./rpc-error-classifier";
import {
  rpcProvenance,
  type ProvenanceOptions,
  type RpcCallResult,
  type RpcGateway,
  type SolanaRpcClient,
} from "./solana-rpc-client";

/**
 * SPEC-006 amendment (PH-AC-07/08): calls the primary endpoint and, when it fails
 * with a failover-eligible error, the fallback once — only while the fallback's
 * cluster is verified. Each endpoint keeps its own budget and health record.
 */
export class FailoverRpcClient implements RpcGateway {
  constructor(
    private readonly primary: SolanaRpcClient,
    private readonly fallback: SolanaRpcClient,
    private readonly isFallbackUsable: () => boolean,
  ) {
    if (primary.network !== fallback.network) {
      throw new Error("Primary and fallback RPC endpoints must serve the same cluster");
    }
  }

  get network(): Cluster {
    return this.primary.network;
  }

  async call<T>(
    method: string,
    execute: (signal: AbortSignal, rpc: Rpc<SolanaRpcApi>) => Promise<T>,
  ): Promise<RpcCallResult<T>> {
    try {
      return await this.primary.call(method, execute);
    } catch (primaryError) {
      if (!isProviderError(primaryError) || !isFailoverEligible(primaryError) || !this.isFallbackUsable()) {
        throw primaryError;
      }
      try {
        const result = await this.fallback.call(method, execute);
        return { ...result, fallbackUsed: true };
      } catch {
        // Both failed: the primary's classified error describes the configured source.
        throw primaryError;
      }
    }
  }

  provenance(options: ProvenanceOptions): Provenance {
    return rpcProvenance(options);
  }
}
