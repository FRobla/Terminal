import type { AuditLog } from "../../audit/application/audit-log";
import { actorAuditFields, type Actor } from "../../auth/application/actor";

export type CacheTarget = "wallet-overview" | "permissions";

export interface PurgeableCache {
  /** Removes every cached entry and returns how many were removed. */
  purge(): Promise<number>;
}

/** OWN-AC-16 — purges one named cache and audits it. Other caches are untouched. */
export class CacheMaintenance {
  constructor(private readonly deps: { caches: Record<CacheTarget, PurgeableCache>; audit: AuditLog }) {}

  async purge(actor: Actor, target: CacheTarget): Promise<{ target: CacheTarget; keysDeleted: number }> {
    const keysDeleted = await this.deps.caches[target].purge();
    await this.deps.audit.record({
      action: "system.cache_purged",
      resourceType: "cache",
      resourceId: target,
      result: "success",
      ...actorAuditFields(actor),
      metadata: { target, keysDeleted },
    });
    return { target, keysDeleted };
  }
}
