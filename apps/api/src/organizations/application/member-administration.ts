import type { AdminUser, AssignableRoleKey } from "@sct/validation";
import type { AuditLog } from "../../audit/application/audit-log";
import { actorAuditFields, type Actor } from "../../auth/application/actor";
import type { UnitOfWork } from "../../auth/application/ports";
import type { SessionAdministration } from "../../auth/application/session-administration";
import { ApiError } from "../../platform/api-error";
import { protectionReason } from "../domain/member-protection";
import type { MemberDirectory, MemberRecord, PermissionCache } from "./ports";

export type OrganizationActor = Actor & { organizationId: string };

const AUDIT_REASON = "owner console";

function roleKeysOf(record: MemberRecord): string[] {
  return record.membership?.roles.map((role) => role.key) ?? [];
}

/** SPEC-026 — people and access, scoped to the owner's active organization (OWN-AC-03 … OWN-AC-08). */
export class MemberAdministration {
  constructor(
    private readonly config: { idleTimeoutSeconds: number },
    private readonly deps: {
      unitOfWork: UnitOfWork;
      members: MemberDirectory;
      sessions: SessionAdministration;
      permissionCache: PermissionCache;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  private clock() {
    const now = this.deps.now?.() ?? new Date();
    return { now, idleSince: new Date(now.getTime() - this.config.idleTimeoutSeconds * 1000) };
  }

  private static toContract(actor: Actor, record: MemberRecord): AdminUser {
    return {
      id: record.id,
      displayName: record.displayName,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
      walletIdentities: record.walletIdentities.map((identity) => ({
        address: identity.address,
        cluster: identity.cluster,
        lastSeenAt: identity.lastSeenAt.toISOString(),
      })),
      membership: record.membership
        ? {
            status: record.membership.status,
            roles: record.membership.roles,
            createdAt: record.membership.createdAt.toISOString(),
          }
        : null,
      activeSessionCount: record.activeSessionCount,
      lastActivityAt: record.lastActivityAt?.toISOString() ?? null,
      protectedReason: protectionReason(actor.userId, { userId: record.id, roleKeys: roleKeysOf(record) }),
    };
  }

  /** OWN-AC-03 */
  async list(actor: OrganizationActor, query: { limit: number; cursor?: string | undefined }) {
    const records = await this.deps.members.list({
      organizationId: actor.organizationId,
      limit: query.limit,
      cursor: query.cursor,
      ...this.clock(),
    });
    return records.map((record) => MemberAdministration.toContract(actor, record));
  }

  async get(actor: OrganizationActor, userId: string): Promise<AdminUser> {
    return MemberAdministration.toContract(actor, await this.findTarget(actor, userId));
  }

  private async findTarget(actor: OrganizationActor, userId: string): Promise<MemberRecord> {
    const record = await this.deps.members.find({
      organizationId: actor.organizationId,
      userId,
      ...this.clock(),
    });
    if (!record) throw new ApiError("NOT_FOUND");
    return record;
  }

  /** OWN-AC-05: refuses actions on the caller and on owners. */
  private async manageableTarget(actor: OrganizationActor, userId: string): Promise<MemberRecord> {
    const record = await this.findTarget(actor, userId);
    const reason = protectionReason(actor.userId, { userId: record.id, roleKeys: roleKeysOf(record) });
    if (reason) {
      throw new ApiError("OPERATION_NOT_ALLOWED", {
        message:
          reason === "SELF"
            ? "You cannot change your own access from the owner console."
            : "Owner accounts cannot be changed from the owner console.",
        details: { reason },
      });
    }
    return record;
  }

  /** OWN-AC-04 */
  async setRole(actor: OrganizationActor, userId: string, roleKey: AssignableRoleKey): Promise<AdminUser> {
    await this.manageableTarget(actor, userId);
    const { now } = this.clock();
    await this.deps.unitOfWork.run(async (transaction) => {
      const change = await this.deps.members.setSingleRole(
        { organizationId: actor.organizationId, userId, roleKey, grantedByUserId: actor.userId, at: now },
        transaction,
      );
      if (change.reactivated) {
        await this.deps.audit.record(
          {
            action: "member.reactivated",
            resourceType: "membership",
            resourceId: userId,
            result: "success",
            ...actorAuditFields(actor),
            metadata: { targetUserId: userId },
          },
          transaction,
        );
      }
      for (const removed of change.removedRoleKeys) {
        await this.deps.audit.record(
          {
            action: "role.revoked",
            resourceType: "membership",
            resourceId: userId,
            result: "success",
            ...actorAuditFields(actor),
            metadata: { roleKey: removed, targetUserId: userId, reason: AUDIT_REASON },
          },
          transaction,
        );
      }
      if (!change.alreadyHeld) {
        await this.deps.audit.record(
          {
            action: "role.assigned",
            resourceType: "membership",
            resourceId: userId,
            result: "success",
            ...actorAuditFields(actor),
            metadata: { roleKey, targetUserId: userId, reason: AUDIT_REASON },
          },
          transaction,
        );
      }
    });
    this.deps.permissionCache.invalidatePermissions();
    return this.get(actor, userId);
  }

  /** OWN-AC-06 */
  async setMembershipStatus(
    actor: OrganizationActor,
    userId: string,
    status: "active" | "suspended",
  ): Promise<AdminUser> {
    const target = await this.manageableTarget(actor, userId);
    if (!target.membership) {
      throw new ApiError("OPERATION_NOT_ALLOWED", {
        message: "This user is not a member of the organization. Assign a role first.",
        details: { reason: "NOT_A_MEMBER" },
      });
    }
    if (target.membership.status !== status) {
      const { now } = this.clock();
      await this.deps.unitOfWork.run(async (transaction) => {
        await this.deps.members.setMembershipStatus(
          { organizationId: actor.organizationId, userId, status, at: now },
          transaction,
        );
        await this.deps.audit.record(
          {
            action: status === "suspended" ? "member.suspended" : "member.reactivated",
            resourceType: "membership",
            resourceId: userId,
            result: "success",
            ...actorAuditFields(actor),
            metadata: { targetUserId: userId },
          },
          transaction,
        );
      });
      this.deps.permissionCache.invalidatePermissions();
    }
    return this.get(actor, userId);
  }

  /** OWN-AC-07: disabling also revokes every session of the account. */
  async setUserStatus(
    actor: OrganizationActor,
    userId: string,
    status: "active" | "disabled",
  ): Promise<AdminUser> {
    const target = await this.manageableTarget(actor, userId);
    if (target.status !== status) {
      const { now } = this.clock();
      await this.deps.unitOfWork.run(async (transaction) => {
        await this.deps.members.setUserStatus({ userId, status, at: now }, transaction);
        if (status === "disabled") {
          const sessionsRevoked = await this.deps.sessions.revokeAllForUser(
            actor,
            userId,
            "account disabled",
            transaction,
          );
          await this.deps.audit.record(
            {
              action: "user.disabled",
              resourceType: "user",
              resourceId: userId,
              result: "success",
              ...actorAuditFields(actor),
              metadata: { targetUserId: userId, sessionsRevoked },
            },
            transaction,
          );
        } else {
          await this.deps.audit.record(
            {
              action: "user.enabled",
              resourceType: "user",
              resourceId: userId,
              result: "success",
              ...actorAuditFields(actor),
              metadata: { targetUserId: userId },
            },
            transaction,
          );
        }
      });
      this.deps.permissionCache.invalidatePermissions();
    }
    return this.get(actor, userId);
  }

  /** OWN-AC-08 */
  async revokeSessions(actor: OrganizationActor, userId: string): Promise<number> {
    await this.manageableTarget(actor, userId);
    return this.deps.sessions.revokeAllForUser(actor, userId, "owner console");
  }
}
