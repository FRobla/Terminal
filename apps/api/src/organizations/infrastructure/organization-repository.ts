import { and, asc, eq, isNull, or, schema, sql, type Database } from "@sct/database";
import type { Transaction } from "../../auth/application/ports";
import type { OrganizationDirectory, OrganizationRecord, RoleRecord } from "../application/ports";

export class OrganizationRepository implements OrganizationDirectory {
  constructor(private readonly db: Database) {}

  async find(organizationId: string): Promise<OrganizationRecord | null> {
    const [organization] = await this.db
      .select({
        id: schema.organizations.id,
        slug: schema.organizations.slug,
        name: schema.organizations.name,
        createdAt: schema.organizations.createdAt,
        updatedAt: schema.organizations.updatedAt,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    if (!organization) return null;

    const memberships = schema.organizationMemberships;
    const [counts] = await this.db
      .select({
        active: sql<number>`count(*) filter (where ${memberships.status} = 'active')`.mapWith(Number),
        suspended: sql<number>`count(*) filter (where ${memberships.status} = 'suspended')`.mapWith(Number),
      })
      .from(memberships)
      .where(eq(memberships.organizationId, organizationId));
    return { ...organization, members: { active: counts?.active ?? 0, suspended: counts?.suspended ?? 0 } };
  }

  async rename(organizationId: string, name: string, at: Date, transaction: Transaction): Promise<void> {
    await (transaction as Database)
      .update(schema.organizations)
      .set({ name, updatedAt: at })
      .where(eq(schema.organizations.id, organizationId));
  }

  async roles(organizationId: string): Promise<RoleRecord[]> {
    const roles = await this.db
      .select({
        id: schema.roles.id,
        key: schema.roles.key,
        name: schema.roles.name,
        isSystem: schema.roles.isSystem,
      })
      .from(schema.roles)
      .where(or(isNull(schema.roles.organizationId), eq(schema.roles.organizationId, organizationId)))
      .orderBy(asc(schema.roles.createdAt), asc(schema.roles.key));

    const permissions = await this.db
      .select({ roleId: schema.rolePermissions.roleId, key: schema.rolePermissions.permissionKey })
      .from(schema.rolePermissions)
      .orderBy(asc(schema.rolePermissions.permissionKey));

    const memberCounts = await this.db
      .select({
        roleId: schema.membershipRoles.roleId,
        activeMembers: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.membershipRoles)
      .innerJoin(
        schema.organizationMemberships,
        eq(schema.organizationMemberships.id, schema.membershipRoles.membershipId),
      )
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, organizationId),
          eq(schema.organizationMemberships.status, "active"),
        ),
      )
      .groupBy(schema.membershipRoles.roleId);

    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      isSystem: role.isSystem,
      permissions: permissions.filter((entry) => entry.roleId === role.id).map((entry) => entry.key),
      activeMembers: memberCounts.find((entry) => entry.roleId === role.id)?.activeMembers ?? 0,
    }));
  }
}
