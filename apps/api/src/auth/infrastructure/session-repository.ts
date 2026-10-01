import { and, desc, eq, gt, inArray, isNull, ne, schema, type Database } from "@sct/database";
import type {
  ActiveSessionCriteria,
  ActiveSessionRecord,
  SessionDirectory,
  SessionStore,
  StoredSession,
  Transaction,
} from "../application/ports";

function activeConditions(criteria: ActiveSessionCriteria) {
  const table = schema.sessions;
  const conditions = [
    isNull(table.revokedAt),
    gt(table.expiresAt, criteria.now),
    gt(table.lastSeenAt, criteria.idleSince),
  ];
  if (criteria.userId) conditions.push(eq(table.userId, criteria.userId));
  if (criteria.sessionIds) conditions.push(inArray(table.id, [...criteria.sessionIds]));
  if (criteria.excludeSessionId) conditions.push(ne(table.id, criteria.excludeSessionId));
  return conditions;
}

export class SessionRepository implements SessionStore, SessionDirectory {
  constructor(private readonly db: Database) {}

  async create(session: Parameters<SessionStore["create"]>[0], transaction: Transaction): Promise<string> {
    const tx = transaction as Database;
    const [row] = await tx
      .insert(schema.sessions)
      .values({ ...session, lastSeenAt: session.createdAt })
      .returning({ id: schema.sessions.id });
    if (!row) throw new Error("Failed to persist session");
    return row.id;
  }

  async findByTokenHash(tokenHash: Buffer): Promise<StoredSession | null> {
    const [row] = await this.db
      .select({
        id: schema.sessions.id,
        userId: schema.sessions.userId,
        displayName: schema.users.displayName,
        userStatus: schema.users.status,
        walletAddress: schema.sessions.walletAddress,
        activeOrganizationId: schema.sessions.activeOrganizationId,
        createdAt: schema.sessions.createdAt,
        lastSeenAt: schema.sessions.lastSeenAt,
        expiresAt: schema.sessions.expiresAt,
        revokedAt: schema.sessions.revokedAt,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(eq(schema.sessions.tokenHash, tokenHash));
    if (!row) return null;
    const { userStatus, ...session } = row;
    // Disabled users are treated as revoked sessions.
    return userStatus === "active" ? session : { ...session, revokedAt: session.revokedAt ?? new Date(0) };
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db.update(schema.sessions).set({ lastSeenAt: at }).where(eq(schema.sessions.id, sessionId));
  }

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.db.update(schema.sessions).set({ revokedAt: at }).where(eq(schema.sessions.id, sessionId));
  }

  async listActive(criteria: ActiveSessionCriteria & { limit: number }): Promise<ActiveSessionRecord[]> {
    const table = schema.sessions;
    return this.db
      .select({
        id: table.id,
        userId: table.userId,
        displayName: schema.users.displayName,
        walletAddress: table.walletAddress,
        createdAt: table.createdAt,
        lastSeenAt: table.lastSeenAt,
        expiresAt: table.expiresAt,
        ipAddress: table.ipAddress,
        userAgent: table.userAgent,
      })
      .from(table)
      .innerJoin(schema.users, eq(schema.users.id, table.userId))
      .where(and(eq(schema.users.status, "active"), ...activeConditions(criteria)))
      .orderBy(desc(table.lastSeenAt), desc(table.id))
      .limit(criteria.limit);
  }

  async revokeActive(
    criteria: ActiveSessionCriteria,
    at: Date,
    transaction?: Transaction,
  ): Promise<string[]> {
    const executor = (transaction as Database | undefined) ?? this.db;
    const rows = await executor
      .update(schema.sessions)
      .set({ revokedAt: at })
      .where(and(...activeConditions(criteria)))
      .returning({ id: schema.sessions.id });
    return rows.map((row) => row.id);
  }
}
