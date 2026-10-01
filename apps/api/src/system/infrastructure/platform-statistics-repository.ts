import { and, desc, eq, gt, gte, isNull, or, schema, sql, type Database } from "@sct/database";
import type { ProviderHealthSnapshot } from "@sct/validation";
import type { PlatformStatistics, ProviderHistoryReader } from "../application/console-ports";

/** Aggregates for the owner console overview (OWN-AC-02). */
export class PlatformStatisticsRepository implements PlatformStatistics {
  constructor(private readonly db: Database) {}

  async collect(query: Parameters<PlatformStatistics["collect"]>[0]) {
    const users = schema.users;
    const memberships = schema.organizationMemberships;
    const sessions = schema.sessions;
    const audit = schema.auditEvents;

    const [userCounts] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${users.status} = 'active')`.mapWith(Number),
        disabled: sql<number>`count(*) filter (where ${users.status} = 'disabled')`.mapWith(Number),
      })
      .from(users);

    const [memberCounts] = await this.db
      .select({
        active: sql<number>`count(*) filter (where ${memberships.status} = 'active')`.mapWith(Number),
        suspended: sql<number>`count(*) filter (where ${memberships.status} = 'suspended')`.mapWith(Number),
      })
      .from(memberships)
      .where(eq(memberships.organizationId, query.organizationId));

    const roles = await this.db
      .select({ key: schema.roles.key, activeMembers: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.membershipRoles)
      .innerJoin(memberships, eq(memberships.id, schema.membershipRoles.membershipId))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
      .where(and(eq(memberships.organizationId, query.organizationId), eq(memberships.status, "active")))
      .groupBy(schema.roles.key)
      .orderBy(schema.roles.key);

    const [sessionCount] = await this.db
      .select({ active: sql<number>`count(*)`.mapWith(Number) })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(users.status, "active"),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, query.now),
          gt(sessions.lastSeenAt, query.idleSince),
        ),
      );

    const [auditCounts] = await this.db
      .select({
        success: sql<number>`count(*) filter (where ${audit.result} = 'success')`.mapWith(Number),
        failure: sql<number>`count(*) filter (where ${audit.result} = 'failure')`.mapWith(Number),
        denied: sql<number>`count(*) filter (where ${audit.result} = 'denied')`.mapWith(Number),
      })
      .from(audit)
      .where(
        and(
          gte(audit.occurredAt, query.auditSince),
          or(eq(audit.organizationId, query.organizationId), isNull(audit.organizationId)),
        ),
      );

    const [lastSnapshot] = await this.db
      .select({ checkedAt: schema.providerHealthChecks.checkedAt })
      .from(schema.providerHealthChecks)
      .orderBy(desc(schema.providerHealthChecks.checkedAt))
      .limit(1);

    return {
      users: userCounts ?? { total: 0, active: 0, disabled: 0 },
      members: memberCounts ?? { active: 0, suspended: 0 },
      roles,
      activeSessions: sessionCount?.active ?? 0,
      audit24h: auditCounts ?? { success: 0, failure: 0, denied: 0 },
      lastProviderSnapshotAt: lastSnapshot?.checkedAt ?? null,
    };
  }
}

/** Worker health snapshots, newest first (OWN-AC-14). */
export class ProviderHistoryRepository implements ProviderHistoryReader {
  constructor(private readonly db: Database) {}

  async list(query: { providerId?: string | undefined; limit: number }): Promise<ProviderHealthSnapshot[]> {
    const table = schema.providerHealthChecks;
    const rows = await this.db
      .select()
      .from(table)
      .where(query.providerId ? eq(table.providerId, query.providerId) : undefined)
      .orderBy(desc(table.checkedAt), desc(table.id))
      .limit(query.limit);
    return rows.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      cluster: row.cluster,
      status: row.status,
      latencyP50Ms: row.latencyP50Ms,
      latencyP95Ms: row.latencyP95Ms,
      errorRate: row.errorRate === null ? null : Number(row.errorRate),
      requestCount: row.requestCount,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
      lastFailureReason: row.lastFailureReason,
      checkedAt: row.checkedAt.toISOString(),
    }));
  }
}
