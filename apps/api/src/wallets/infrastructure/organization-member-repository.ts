import { and, asc, eq, schema, sql, type Database } from "@sct/database";
import type { Transaction } from "../../auth/application/ports";
import type { OrganizationMember, OrganizationMemberDirectory } from "../application/registry-ports";

/** Active members of an organization, for wallet assignments (SPEC-009 §4.6). */
export class OrganizationMemberRepository implements OrganizationMemberDirectory {
  constructor(private readonly db: Database) {}

  async slugOf(organizationId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ slug: schema.organizations.slug })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    return row?.slug ?? null;
  }

  async listActive(organizationId: string): Promise<OrganizationMember[]> {
    return this.db
      .select({
        userId: schema.users.id,
        displayName: schema.users.displayName,
        walletAddress: sql<string | null>`(
          select ${schema.userWalletIdentities.address} from ${schema.userWalletIdentities}
          where ${schema.userWalletIdentities.userId} = ${schema.users.id}
          order by ${schema.userWalletIdentities.lastSeenAt} desc limit 1
        )`,
      })
      .from(schema.organizationMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMemberships.userId))
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, organizationId),
          eq(schema.organizationMemberships.status, "active"),
          eq(schema.users.status, "active"),
        ),
      )
      .orderBy(asc(schema.users.displayName), asc(schema.users.id))
      .limit(500);
  }

  async isActiveMember(organizationId: string, userId: string, transaction?: Transaction): Promise<boolean> {
    const db = (transaction as Database | undefined) ?? this.db;
    const [row] = await db
      .select({ id: schema.organizationMemberships.id })
      .from(schema.organizationMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMemberships.userId))
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, organizationId),
          eq(schema.organizationMemberships.userId, userId),
          eq(schema.organizationMemberships.status, "active"),
          eq(schema.users.status, "active"),
        ),
      );
    return row !== undefined;
  }
}
