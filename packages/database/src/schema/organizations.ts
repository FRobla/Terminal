import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId, updatedAt } from "./columns";
import { users } from "./users";

export const organizations = pgTable("organizations", {
  id: primaryId(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("organization_memberships_org_user_unique").on(table.organizationId, table.userId),
    index("organization_memberships_user_id_idx").on(table.userId),
    check("organization_memberships_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

/** System roles have a null organization; custom organization roles arrive in Iteration 08. */
export const roles = pgTable(
  "roles",
  {
    id: primaryId(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique("roles_org_key_unique").on(table.organizationId, table.key).nullsNotDistinct()],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.membershipId, table.roleId] })],
);
