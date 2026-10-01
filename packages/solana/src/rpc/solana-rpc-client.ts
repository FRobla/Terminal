import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";
import type { Cluster } from "@sct/network";
import {
  executeProviderCall,
  redactEndpoint,
  type ProviderCallDependencies,
  type ProviderCallResult,
  type ProviderDescriptor,
} from "@sct/providers";
import type { Provenance } from "@sct/validation";
import { classifyRpcError } from "./rpc-error-classifier";

export type Commitment = "processed" | "confirmed" | "finalized";

/** Shared by api and worker so both processes use one budget and one health record. */
export const PRIMARY_RPC_PROVIDER_ID = "solana-public-rpc";

/**
 * Budget below the documented public Devnet limits (100 req/10 s per IP,
 * 40 req/10 s per method), shared across all processes (DATA_SOURCES.md §4.1).
 */
export function solanaRpcProviderDescriptor(options: {
  id: string;
  displayName: string;
  cluster: Cluster;
  endpoint: string;
}): ProviderDescriptor {
  return {
    id: options.id,
    displayName: options.displayName,
    sourceType: "rpc",
    network: options.cluster,
    endpoint: options.endpoint,
    authMode: "none",
    budget: { requestsPerWindow: 70, windowMs: 10_000, perMethodRequestsPerWindow: 25, maxConcurrency: 8 },
    timeoutMs: 8_000,
    retry: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 },
    degradedLatencyMs: 2_000,
    docsUrl: "https://solana.com/docs/references/clusters",
    lastVerifiedAt: "2026-09-30",
  };
}

/** Context every read carries so provenance can be correlated with logs and audit events. */
export interface ReadContext {
  requestId: string;
}

export interface RpcReading<T> {
  value: T;
  provenance: Provenance;
}

/**
 * Thin wrapper binding a Kit RPC client to its provider descriptor and the
 * provider-call pipeline. Readers use it; it is not a general "Solana service".
 */
export class SolanaRpcClient {
  readonly rpc: Rpc<SolanaRpcApi>;

  constructor(
    readonly descriptor: ProviderDescriptor,
    private readonly callDependencies: ProviderCallDependencies,
    rpc?: Rpc<SolanaRpcApi>,
  ) {
    this.rpc = rpc ?? createSolanaRpc(descriptor.endpoint);
  }

  call<T>(method: string, execute: (signal: AbortSignal) => Promise<T>): Promise<ProviderCallResult<T>> {
    return executeProviderCall(this.callDependencies, {
      provider: this.descriptor,
      method,
      execute,
      classify: (error) => classifyRpcError(this.descriptor.id, error),
    });
  }

  provenance(options: {
    method: string;
    result: ProviderCallResult<unknown>;
    context: ReadContext;
    dataVersion: string;
    commitment?: Commitment;
    slot?: bigint;
  }): Provenance {
    return {
      source: `solana-rpc-${this.descriptor.network}`,
      sourceType: "rpc",
      provider: this.descriptor.id,
      endpoint: redactEndpoint(this.descriptor.endpoint),
      method: options.method,
      network: this.descriptor.network,
      ...(options.commitment ? { commitment: options.commitment } : {}),
      ...(options.slot !== undefined ? { slot: options.slot.toString() } : {}),
      retrievedAt: options.result.retrievedAt.toISOString(),
      observedAt: null,
      requestId: options.context.requestId,
      dataVersion: options.dataVersion,
      confidence: "AUTHORITATIVE",
      latencyMs: options.result.latencyMs,
      responseStatus: 200,
      fallbackUsed: false,
    };
  }
}
