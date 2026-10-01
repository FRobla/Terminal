import type { Cluster } from "@sct/network";

/** Provider registry entry (DATA_SOURCES.md §5). */
export interface ProviderDescriptor {
  id: string;
  displayName: string;
  sourceType: "rpc" | "rest" | "websocket" | "sdk-onchain";
  network: Cluster;
  /** Raw endpoint; may contain credentials. Use `redactEndpoint` before exposing it. */
  endpoint: string;
  authMode: "none" | "apiKeyHeader" | "apiKeyQuery";
  budget: {
    requestsPerWindow: number;
    windowMs: number;
    perMethodRequestsPerWindow?: number;
    maxConcurrency: number;
  };
  timeoutMs: number;
  retry: RetryPolicy;
  /** p95 latency above which the provider is considered degraded. */
  degradedLatencyMs: number;
  docsUrl: string;
  lastVerifiedAt: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}
