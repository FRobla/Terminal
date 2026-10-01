import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { users } from "./users";

/**
 * Platform-wide settings managed from the owner console (SPEC-026), keyed by setting name.
 * Values are versioned configuration validated by a Zod schema at the API boundary.
 */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
