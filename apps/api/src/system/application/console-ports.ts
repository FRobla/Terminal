import type { DatabaseFacts, ProviderHealthSnapshot, QueueState, RedisFacts } from "@sct/validation";

/** Ports for the owner console's system views (SPEC-026). */

export interface PlatformStatistics {
  collect(query: { organizationId: string; now: Date; idleSince: Date; auditSince: Date }): Promise<{
    users: { total: number; active: number; disabled: number };
    members: { active: number; suspended: number };
    roles: Array<{ key: string; activeMembers: number }>;
    activeSessions: number;
    audit24h: { success: number; failure: number; denied: number };
    lastProviderSnapshotAt: Date | null;
  }>;
}

export interface DatabaseInspector {
  inspect(): Promise<DatabaseFacts>;
}

export interface RedisInspector {
  inspect(): Promise<RedisFacts>;
}

export interface ProviderHistoryReader {
  list(query: { providerId?: string | undefined; limit: number }): Promise<ProviderHealthSnapshot[]>;
}

export interface QueueInspector {
  readonly queueName: string;
  inspect(): Promise<QueueState>;
}

export interface ProviderProbeQueue extends QueueInspector {
  /** Enqueues one provider health probe and returns the job id. */
  enqueueProbe(): Promise<{ jobId: string; jobName: string }>;
}
