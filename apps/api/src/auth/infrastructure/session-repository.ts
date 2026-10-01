import { eq, schema, type Database } from "@sct/database";
import type { SessionStore, StoredSession, Transaction } from "../application/ports";

export class SessionRepository implements SessionStore {
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
}
