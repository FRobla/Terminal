import { and, asc, desc, eq, gt, inArray, isNull, schema, sql, type Database } from "@sct/database";
import type { Transaction } from "../../auth/application/ports";
import type { MemberDirectory, MemberRecord } from "../application/ports";

export class MemberDirectoryRepository implements MemberDirectory {
  constructor(private readonly db: Database) {}

  async list(query: Parameters<MemberDirectory["list"]>[0]): Promise<MemberRecord[]> {
    const users = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(query.cursor ? gt(schema.users.id, query.cursor) : undefined)
      .orderBy(asc(schema.users.id))
      .limit(query.limit);
    return this.enrich(users, query);
  }

  async find(query: Parameters<MemberDirectory["find"]>[0]): Promise<MemberRecord | null> {
    const users = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, query.userId));
    const [record] = await this.enrich(users, query);
    return record ?? null;
  }

  private async enrich(
    users: Array<{ id: string; displayName: string | null; status: string; createdAt: Date }>,
    query: { organizationId: string; idleSince: Date; now: Date },
  ): Promise<MemberRecord[]> {
    if (users.length === 0) return [];
    const ids = users.map((user) => user.id);

    const identities = await this.db
      .select({
        userId: schema.userWalletIdentities.userId,
        address: schema.userWalletIdentities.address,
        cluster: schema.userWalletIdentities.cluster,
        lastSeenAt: schema.userWalletIdentities.lastSeenAt,
      })
      .from(schema.userWalletIdentities)
      .where(inArray(schema.userWalletIdentities.userId, ids))
      .orderBy(desc(schema.userWalletIdentities.lastSeenAt));

    const memberships = await this.db
      .select({
        id: schema.organizationMemberships.id,
        userId: schema.organizationMemberships.userId,
        status: schema.organizationMemberships.status,
        createdAt: schema.organizationMemberships.createdAt,
      })
      .from(schema.organizationMemberships)
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, query.organizationId),
          inArray(schema.organizationMemberships.userId, ids),
        ),
      );

    const membershipIds = memberships.map((membership) => membership.id);
    const roles =
      membershipIds.length === 0
        ? []
        : await this.db
            .select({
              membershipId: schema.membershipRoles.membershipId,
              key: schema.roles.key,
              name: schema.roles.name,
            })
            .from(schema.membershipRoles)
            .innerJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
            .where(inArray(schema.membershipRoles.membershipId, membershipIds))
            .orderBy(asc(schema.roles.key));

    const sessions = schema.sessions;
    const activity = await this.db
      .select({
        userId: sessions.userId,
        activeCount:
          sql<number>`count(*) filter (where ${sessions.revokedAt} is null and ${sessions.expiresAt} > ${query.now.toISOString()}::timestamptz and ${sessions.lastSeenAt} > ${query.idleSince.toISOString()}::timestamptz)`.mapWith(
            Number,
          ),
        lastActivityAt: sql<Date | null>`max(${sessions.lastSeenAt})`.mapWith(
          (value: string | Date | null) => (value === null ? null : new Date(value)),
        ),
      })
      .from(sessions)
      .where(inArray(sessions.userId, ids))
      .groupBy(sessions.userId);

    return users.map((user) => {
      const membership = memberships.find((entry) => entry.userId === user.id);
      const sessionActivity = activity.find((entry) => entry.userId === user.id);
      return {
        id: user.id,
        displayName: user.displayName,
        status: user.status === "disabled" ? "disabled" : "active",
        createdAt: user.createdAt,
        walletIdentities: identities
          .filter((identity) => identity.userId === user.id)
          .map(({ address, cluster, lastSeenAt }) => ({ address, cluster, lastSeenAt })),
        membership: membership
          ? {
              status: membership.status === "suspended" ? "suspended" : "active",
              roles: roles
                .filter((role) => role.membershipId === membership.id)
                .map(({ key, name }) => ({ key, name })),
              createdAt: membership.createdAt,
            }
          : null,
        activeSessionCount: sessionActivity?.activeCount ?? 0,
        lastActivityAt: sessionActivity?.lastActivityAt ?? null,
      };
    });
  }

  async setSingleRole(
    command: Parameters<MemberDirectory["setSingleRole"]>[0],
    transaction: Transaction,
  ): Promise<{ removedRoleKeys: string[]; alreadyHeld: boolean; reactivated: boolean }> {
    const tx = transaction as Database;
    const [role] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(isNull(schema.roles.organizationId), eq(schema.roles.key, command.roleKey)));
    if (!role) throw new Error(`System role ${command.roleKey} is missing; run the seed.`);

    const [previous] = await tx
      .select({ status: schema.organizationMemberships.status })
      .from(schema.organizationMemberships)
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, command.organizationId),
          eq(schema.organizationMemberships.userId, command.userId),
        ),
      )
      .for("update");

    const [membership] = await tx
      .insert(schema.organizationMemberships)
      .values({ organizationId: command.organizationId, userId: command.userId })
      .onConflictDoUpdate({
        target: [schema.organizationMemberships.organizationId, schema.organizationMemberships.userId],
        set: { status: "active", updatedAt: command.at },
      })
      .returning({ id: schema.organizationMemberships.id });
    if (!membership) throw new Error("Failed to upsert membership");

    const current = await tx
      .select({ roleId: schema.membershipRoles.roleId, key: schema.roles.key })
      .from(schema.membershipRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
      .where(eq(schema.membershipRoles.membershipId, membership.id));

    const removed = current.filter((entry) => entry.roleId !== role.id);
    if (removed.length > 0) {
      await tx.delete(schema.membershipRoles).where(
        and(
          eq(schema.membershipRoles.membershipId, membership.id),
          inArray(
            schema.membershipRoles.roleId,
            removed.map((entry) => entry.roleId),
          ),
        ),
      );
    }
    const alreadyHeld = current.some((entry) => entry.roleId === role.id);
    if (!alreadyHeld) {
      await tx.insert(schema.membershipRoles).values({
        membershipId: membership.id,
        roleId: role.id,
        grantedByUserId: command.grantedByUserId,
        createdAt: command.at,
      });
    }

    // Sessions opened before the user had a membership have no active organization yet.
    await tx
      .update(schema.sessions)
      .set({ activeOrganizationId: command.organizationId })
      .where(
        and(
          eq(schema.sessions.userId, command.userId),
          isNull(schema.sessions.activeOrganizationId),
          isNull(schema.sessions.revokedAt),
        ),
      );

    return {
      removedRoleKeys: removed.map((entry) => entry.key),
      alreadyHeld,
      reactivated: previous?.status === "suspended",
    };
  }

  async setMembershipStatus(
    command: Parameters<MemberDirectory["setMembershipStatus"]>[0],
    transaction: Transaction,
  ): Promise<void> {
    await (transaction as Database)
      .update(schema.organizationMemberships)
      .set({ status: command.status, updatedAt: command.at })
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, command.organizationId),
          eq(schema.organizationMemberships.userId, command.userId),
        ),
      );
  }

  async setUserStatus(
    command: Parameters<MemberDirectory["setUserStatus"]>[0],
    transaction: Transaction,
  ): Promise<void> {
    await (transaction as Database)
      .update(schema.users)
      .set({ status: command.status, updatedAt: command.at })
      .where(eq(schema.users.id, command.userId));
  }
}
