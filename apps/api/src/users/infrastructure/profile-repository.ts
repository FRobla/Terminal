import { and, asc, eq, schema, type Database } from "@sct/database";
import type { ProfileRecord, ProfileStore } from "../application/ports";

export class ProfileRepository implements ProfileStore {
  constructor(private readonly db: Database) {}

  async load(userId: string, organizationId: string | null): Promise<ProfileRecord | null> {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) return null;

    const walletIdentities = await this.db
      .select({
        address: schema.userWalletIdentities.address,
        cluster: schema.userWalletIdentities.cluster,
        firstSeenAt: schema.userWalletIdentities.firstSeenAt,
        lastSeenAt: schema.userWalletIdentities.lastSeenAt,
      })
      .from(schema.userWalletIdentities)
      .where(eq(schema.userWalletIdentities.userId, userId))
      .orderBy(asc(schema.userWalletIdentities.firstSeenAt));

    const roles = organizationId
      ? await this.db
          .select({ key: schema.roles.key, name: schema.roles.name })
          .from(schema.organizationMemberships)
          .innerJoin(
            schema.membershipRoles,
            eq(schema.membershipRoles.membershipId, schema.organizationMemberships.id),
          )
          .innerJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
          .where(
            and(
              eq(schema.organizationMemberships.userId, userId),
              eq(schema.organizationMemberships.organizationId, organizationId),
              eq(schema.organizationMemberships.status, "active"),
            ),
          )
          .orderBy(asc(schema.roles.key))
      : [];

    return {
      user: { ...user, status: user.status === "disabled" ? "disabled" : "active" },
      walletIdentities,
      roles,
    };
  }

  async updateDisplayName(userId: string, displayName: string | null, at: Date): Promise<void> {
    await this.db.update(schema.users).set({ displayName, updatedAt: at }).where(eq(schema.users.id, userId));
  }
}
