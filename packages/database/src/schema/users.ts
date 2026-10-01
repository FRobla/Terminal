import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, primaryId, updatedAt } from "./columns";
import { clusterEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("users_status_check", sql`${table.status} in ('active', 'disabled')`)],
);

/** Wallets used to sign in (SIWS). Not operational wallets (docs/architecture/domain-model.md §1). */
export const userWalletIdentities = pgTable(
  "user_wallet_identities",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    address: text("address").notNull(),
    cluster: clusterEnum("cluster").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("user_wallet_identities_address_cluster_unique").on(table.address, table.cluster),
    index("user_wallet_identities_user_id_idx").on(table.userId),
  ],
);
