import { customType, index, inet, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./columns";
import { clusterEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Single-use Sign-In With Solana challenges (SPEC-007 §3). */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: primaryId(),
    address: text("address").notNull(),
    cluster: clusterEnum("cluster").notNull(),
    nonce: text("nonce").notNull().unique(),
    message: text("message").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requesterIp: inet("requester_ip"),
  },
  (table) => [index("auth_challenges_expires_at_idx").on(table.expiresAt)],
);

/** Server-side sessions. Only a SHA-256 hash of the session token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    tokenHash: bytea("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    walletAddress: text("wallet_address").notNull(),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);
