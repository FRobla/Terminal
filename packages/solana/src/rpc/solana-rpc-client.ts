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

/** Optional second endpoint (SPEC-006 amendment), shared by api and worker like the primary. */
export const FALLBACK_RPC_PROVIDER_ID = "solana-fallback-rpc";

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

/** A provider call result plus the endpoint that served it (primary or fallback, SPEC-006 PH-AC-07). */
export interface RpcCallResult<T> extends ProviderCallResult<T> {
  servedBy: ProviderDescriptor;
  fallbackUsed: boolean;
}

/**
 * What readers need from an RPC connection: run one method through the provider
 * pipeline against some endpoint, and describe the result's provenance.
 */
export interface RpcGateway {
  readonly network: Cluster;
  call<T>(
    method: string,
    execute: (signal: AbortSignal, rpc: Rpc<SolanaRpcApi>) => Promise<T>,
  ): Promise<RpcCallResult<T>>;
  provenance(options: ProvenanceOptions): Provenance;
}

export interface ProvenanceOptions {
  method: string;
  result: RpcCallResult<unknown>;
  context: ReadContext;
  dataVersion: string;
  commitment?: Commitment;
  slot?: bigint;
}

/**
 * Thin wrapper binding a Kit RPC client to its provider descriptor and the
 * provider-call pipeline. Readers use it; it is not a general "Solana service".
 */
export class SolanaRpcClient implements RpcGateway {
  readonly rpc: Rpc<SolanaRpcApi>;

  constructor(
    readonly descriptor: ProviderDescriptor,
    private readonly callDependencies: ProviderCallDependencies,
    rpc?: Rpc<SolanaRpcApi>,
  ) {
    this.rpc = rpc ?? createSolanaRpc(descriptor.endpoint);
  }

  get network(): Cluster {
    return this.descriptor.network;
  }

  async call<T>(
    method: string,
    execute: (signal: AbortSignal, rpc: Rpc<SolanaRpcApi>) => Promise<T>,
  ): Promise<RpcCallResult<T>> {
    const result = await executeProviderCall(this.callDependencies, {
      provider: this.descriptor,
      method,
      execute: (signal) => execute(signal, this.rpc),
      classify: (error) => classifyRpcError(this.descriptor.id, error),
    });
    return { ...result, servedBy: this.descriptor, fallbackUsed: false };
  }

  provenance(options: ProvenanceOptions): Provenance {
    return rpcProvenance(options);
  }
}

/** SPEC-003 provenance of an RPC reading, naming the endpoint that actually served it. */
export function rpcProvenance(options: ProvenanceOptions): Provenance {
  const servedBy = options.result.servedBy;
  return {
    source: `solana-rpc-${servedBy.network}`,
    sourceType: "rpc",
    provider: servedBy.id,
    endpoint: redactEndpoint(servedBy.endpoint),
    method: options.method,
    network: servedBy.network,
    ...(options.commitment ? { commitment: options.commitment } : {}),
    ...(options.slot !== undefined ? { slot: options.slot.toString() } : {}),
    retrievedAt: options.result.retrievedAt.toISOString(),
    observedAt: null,
    requestId: options.context.requestId,
    dataVersion: options.dataVersion,
    confidence: "AUTHORITATIVE",
    latencyMs: options.result.latencyMs,
    responseStatus: 200,
    fallbackUsed: options.result.fallbackUsed,
  };
}
