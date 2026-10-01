import type { ProviderDescriptor, ProviderHealthStore } from "@sct/providers";
import type { AdminOverview } from "@sct/validation";
import type { ClusterVerificationService } from "./cluster-verification-service";
import type { PlatformStatistics } from "./console-ports";
import { readProviderHealth } from "./provider-health-reader";
import { checkReadiness, type ReadinessProbes } from "./readiness";

const AUDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** SPEC-026 OWN-AC-02 — platform counters and live status for the owner console. */
export class PlatformOverview {
  constructor(
    private readonly config: { idleTimeoutSeconds: number },
    private readonly deps: {
      statistics: PlatformStatistics;
      readiness: ReadinessProbes;
      clusterVerification: ClusterVerificationService;
      rpcProviderName: string;
      providers: readonly ProviderDescriptor[];
      health: ProviderHealthStore;
      now?: () => Date;
    },
  ) {}

  async read(organizationId: string): Promise<AdminOverview> {
    const now = this.deps.now?.() ?? new Date();
    const [statistics, readiness, providers] = await Promise.all([
      this.deps.statistics.collect({
        organizationId,
        now,
        idleSince: new Date(now.getTime() - this.config.idleTimeoutSeconds * 1000),
        auditSince: new Date(now.getTime() - AUDIT_WINDOW_MS),
      }),
      checkReadiness(this.deps.readiness),
      readProviderHealth(this.deps.providers, this.deps.health),
    ]);
    return {
      ...statistics,
      lastProviderSnapshotAt: statistics.lastProviderSnapshotAt?.toISOString() ?? null,
      readiness,
      cluster: this.deps.clusterVerification.identity(this.deps.rpcProviderName),
      providers,
    };
  }
}
