import { and, eq, isNull, schema, type Database } from "@sct/database";
import { PERMISSIONS, type Permission } from "@sct/validation";
import type { MembershipStore, OrganizationSummary, Transaction } from "../../auth/application/ports";

export class MembershipRepository implements MembershipStore {
  constructor(private readonly db: Database) {}

  async findFirstActiveOrganization(
    userId: string,
    transaction?: Transaction,
  ): Promise<OrganizationSummary | null> {
    const executor = (transaction as Database | undefined) ?? this.db;
    const [row] = await executor
      .select({
        id: schema.organizations.id,
        slug: schema.organizations.slug,
        name: schema.organizations.name,
      })
      .from(schema.organizationMemberships)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.organizationMemberships.organizationId),
      )
      .where(
        and(
          eq(schema.organizationMemberships.userId, userId),
          eq(schema.organizationMemberships.status, "active"),
        ),
      )
      .orderBy(schema.organizationMemberships.createdAt)
      .limit(1);
    return row ?? null;
  }

  async findOrganization(organizationId: string): Promise<OrganizationSummary | null> {
    const [row] = await this.db
      .select({
        id: schema.organizations.id,
        slug: schema.organizations.slug,
        name: schema.organizations.name,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    return row ?? null;
  }

  async loadPermissions(userId: string, organizationId: string): Promise<Permission[]> {
    const rows = await this.db
      .selectDistinct({ key: schema.rolePermissions.permissionKey })
      .from(schema.organizationMemberships)
      .innerJoin(
        schema.membershipRoles,
        eq(schema.membershipRoles.membershipId, schema.organizationMemberships.id),
      )
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.membershipRoles.roleId))
      .where(
        and(
          eq(schema.organizationMemberships.userId, userId),
          eq(schema.organizationMemberships.organizationId, organizationId),
          eq(schema.organizationMemberships.status, "active"),
        ),
      );
    const known = new Set<string>(PERMISSIONS);
    return rows.map((row) => row.key).filter((key): key is Permission => known.has(key));
  }

  async grantBootstrapOwnerIfUnowned(userId: string, organizationSlug: string, transaction: Transaction) {
    const tx = transaction as Database;
    const [organization] = await tx
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, organizationSlug))
      .for("update");
    if (!organization) return { granted: false, organizationId: null };

    const [ownerRole] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(isNull(schema.roles.organizationId), eq(schema.roles.key, "owner")));
    if (!ownerRole) return { granted: false, organizationId: organization.id };

    const [existingOwner] = await tx
      .select({ membershipId: schema.membershipRoles.membershipId })
      .from(schema.membershipRoles)
      .innerJoin(
        schema.organizationMemberships,
        eq(schema.organizationMemberships.id, schema.membershipRoles.membershipId),
      )
      .where(
        and(
          eq(schema.membershipRoles.roleId, ownerRole.id),
          eq(schema.organizationMemberships.organizationId, organization.id),
          eq(schema.organizationMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (existingOwner) return { granted: false, organizationId: organization.id };

    const [membership] = await tx
      .insert(schema.organizationMemberships)
      .values({ organizationId: organization.id, userId })
      .onConflictDoUpdate({
        target: [schema.organizationMemberships.organizationId, schema.organizationMemberships.userId],
        set: { status: "active" },
      })
      .returning({ id: schema.organizationMemberships.id });
    if (!membership) throw new Error("Failed to create bootstrap membership");

    await tx
      .insert(schema.membershipRoles)
      .values({ membershipId: membership.id, roleId: ownerRole.id })
      .onConflictDoNothing();
    return { granted: true, organizationId: organization.id };
  }
}
