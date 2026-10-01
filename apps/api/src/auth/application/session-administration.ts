import type { AdminSessionSummary, SessionSummary } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { ApiError } from "../../platform/api-error";
import { actorAuditFields, type Actor } from "./actor";
import type { ActiveSessionCriteria, ActiveSessionRecord, SessionDirectory, Transaction } from "./ports";

export const ADMIN_SESSION_LIST_LIMIT = 500;
const OWN_SESSION_LIST_LIMIT = 100;

export type RevocationReason = "self service" | "owner console" | "account disabled";

/** Lists and revokes sessions: the caller's own (SPEC-025) and platform-wide for the owner (SPEC-026). */
export class SessionAdministration {
  constructor(
    private readonly config: { idleTimeoutSeconds: number },
    private readonly deps: { directory: SessionDirectory; audit: AuditLog; now?: () => Date },
  ) {}

  private criteria(extra: Omit<ActiveSessionCriteria, "now" | "idleSince"> = {}): ActiveSessionCriteria {
    const now = this.deps.now?.() ?? new Date();
    return { now, idleSince: new Date(now.getTime() - this.config.idleTimeoutSeconds * 1000), ...extra };
  }

  private static summary(record: ActiveSessionRecord, currentSessionId: string): SessionSummary {
    return {
      id: record.id,
      walletAddress: record.walletAddress,
      createdAt: record.createdAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      current: record.id === currentSessionId,
    };
  }

  /** SET-AC-07 */
  async listOwn(actor: Actor): Promise<SessionSummary[]> {
    const records = await this.deps.directory.listActive({
      ...this.criteria({ userId: actor.userId }),
      limit: OWN_SESSION_LIST_LIMIT,
    });
    return records.map((record) => SessionAdministration.summary(record, actor.sessionId));
  }

  /** OWN-AC-08 */
  async listAll(actor: Actor): Promise<AdminSessionSummary[]> {
    const records = await this.deps.directory.listActive({
      ...this.criteria(),
      limit: ADMIN_SESSION_LIST_LIMIT,
    });
    return records.map((record) => ({
      ...SessionAdministration.summary(record, actor.sessionId),
      user: { id: record.userId, displayName: record.displayName },
    }));
  }

  /** SET-AC-08: one of the caller's other sessions. Another user's session is reported as not found. */
  async revokeOwn(actor: Actor, sessionId: string): Promise<number> {
    if (sessionId === actor.sessionId) {
      throw new ApiError("OPERATION_NOT_ALLOWED", {
        message: "The current session cannot be revoked here. Sign out instead.",
        details: { reason: "CURRENT_SESSION" },
      });
    }
    return this.revoke(actor, this.criteria({ userId: actor.userId, sessionIds: [sessionId] }), {
      targetUserId: actor.userId,
      scope: "single",
      reason: "self service",
      requireMatch: true,
    });
  }

  /** SET-AC-08: every other session of the caller. */
  async revokeOwnOthers(actor: Actor): Promise<number> {
    return this.revoke(actor, this.criteria({ userId: actor.userId, excludeSessionId: actor.sessionId }), {
      targetUserId: actor.userId,
      scope: "others",
      reason: "self service",
    });
  }

  /** OWN-AC-08: any single session except the caller's current one. */
  async revokeAny(actor: Actor, sessionId: string): Promise<number> {
    if (sessionId === actor.sessionId) {
      throw new ApiError("OPERATION_NOT_ALLOWED", {
        message: "Your current session cannot be revoked from the console. Sign out instead.",
        details: { reason: "CURRENT_SESSION" },
      });
    }
    const [record] = await this.deps.directory.listActive({
      ...this.criteria({ sessionIds: [sessionId] }),
      limit: 1,
    });
    if (!record) throw new ApiError("NOT_FOUND");
    return this.revoke(actor, this.criteria({ sessionIds: [sessionId] }), {
      targetUserId: record.userId,
      scope: "single",
      reason: "owner console",
      requireMatch: true,
    });
  }

  /** OWN-AC-07/08: all sessions of a user. Callers check account protection first. */
  async revokeAllForUser(
    actor: Actor,
    targetUserId: string,
    reason: RevocationReason,
    transaction?: Transaction,
  ): Promise<number> {
    return this.revoke(
      actor,
      this.criteria({ userId: targetUserId }),
      { targetUserId, scope: "all", reason },
      transaction,
    );
  }

  private async revoke(
    actor: Actor,
    criteria: ActiveSessionCriteria,
    event: {
      targetUserId: string;
      scope: "single" | "others" | "all";
      reason: RevocationReason;
      requireMatch?: boolean;
    },
    transaction?: Transaction,
  ): Promise<number> {
    const revoked = await this.deps.directory.revokeActive(criteria, criteria.now, transaction);
    if (event.requireMatch && revoked.length === 0) throw new ApiError("NOT_FOUND");
    if (revoked.length > 0) {
      await this.deps.audit.record(
        {
          action: "session.revoked",
          resourceType: revoked.length === 1 ? "session" : "user",
          resourceId: revoked.length === 1 ? (revoked[0] ?? null) : event.targetUserId,
          result: "success",
          ...actorAuditFields(actor),
          metadata: {
            targetUserId: event.targetUserId,
            scope: event.scope,
            reason: event.reason,
            count: revoked.length,
          },
        },
        transaction,
      );
    }
    return revoked.length;
  }
}
