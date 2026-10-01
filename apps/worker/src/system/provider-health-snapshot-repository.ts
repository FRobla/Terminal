import { schema, type Database } from "@sct/database";
import type { ProviderHealth } from "@sct/validation";
import type { ProviderHealthSnapshotWriter } from "./provider-health-probe";

export class ProviderHealthSnapshotRepository implements ProviderHealthSnapshotWriter {
  constructor(private readonly db: Database) {}

  async write(health: ProviderHealth): Promise<void> {
    const date = (value: string | null) => (value ? new Date(value) : null);
    await this.db.insert(schema.providerHealthChecks).values({
      providerId: health.providerId,
      cluster: health.network,
      status: health.status,
      latencyP50Ms: health.latencyP50Ms,
      latencyP95Ms: health.latencyP95Ms,
      errorRate: health.errorRate === null ? null : health.errorRate.toFixed(4),
      requestCount: health.requestCount,
      lastSuccessAt: date(health.lastSuccessAt),
      lastFailureAt: date(health.lastFailureAt),
      lastFailureReason: health.lastFailureReason,
      checkedAt: new Date(health.checkedAt),
    });
  }
}
