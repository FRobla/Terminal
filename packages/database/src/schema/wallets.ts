import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId, updatedAt } from "./columns";
import { clusterEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";

/** Organization-registered operational wallets (SPEC-009). Never deleted; archived instead. */
export const managedWallets = pgTable(
  "managed_wallets",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    address: text("address").notNull(),
    cluster: clusterEnum("cluster").notNull(),
    label: text("label").notNull(),
    purpose: text("purpose"),
    category: text("category").notNull(),
    custodyType: text("custody_type").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("managed_wallets_org_address_cluster_unique").on(
      table.organizationId,
      table.address,
      table.cluster,
    ),
    index("managed_wallets_org_cluster_created_idx").on(table.organizationId, table.cluster, table.createdAt),
    check("managed_wallets_status_check", sql`${table.status} in ('active', 'archived')`),
    check(
      "managed_wallets_category_check",
      sql`${table.category} in ('TREASURY', 'TRADING', 'OPERATIONS', 'DEVELOPMENT', 'TOKEN_ISSUANCE', 'RESEARCH', 'COLD_STORAGE', 'WATCH_ONLY')`,
    ),
    check(
      "managed_wallets_custody_type_check",
      sql`${table.custodyType} in ('BROWSER_WALLET', 'LOCAL_ENCRYPTED', 'WATCH_ONLY')`,
    ),
    check(
      "managed_wallets_watch_only_category_check",
      sql`${table.category} <> 'WATCH_ONLY' or ${table.custodyType} = 'WATCH_ONLY'`,
    ),
  ],
);

export const walletTags = pgTable(
  "wallet_tags",
  {
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => managedWallets.id, { onDelete: "restrict" }),
    tag: text("tag").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.walletId, table.tag] }),
    index("wallet_tags_tag_idx").on(table.tag),
  ],
);

/** Application wallet roles; never protocol authorities (domain model §1). */
export const walletAssignments = pgTable(
  "wallet_assignments",
  {
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => managedWallets.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.walletId, table.userId, table.role] }),
    index("wallet_assignments_user_id_idx").on(table.userId),
    check(
      "wallet_assignments_role_check",
      sql`${table.role} in ('CREATOR', 'FUNDER', 'CONTROLLER', 'VIEWER')`,
    ),
  ],
);

/** Single-use proof-of-control challenges for registration (SPEC-009 §3). */
export const walletOwnershipChallenges = pgTable(
  "wallet_ownership_challenges",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    address: text("address").notNull(),
    cluster: clusterEnum("cluster").notNull(),
    nonce: text("nonce").notNull().unique(),
    message: text("message").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [index("wallet_ownership_challenges_expires_at_idx").on(table.expiresAt)],
);

/** Indexer cursor and health per registered wallet (SPEC-009 §3). */
export const walletSyncState = pgTable("wallet_sync_state", {
  walletId: uuid("wallet_id")
    .primaryKey()
    .references(() => managedWallets.id, { onDelete: "restrict" }),
  newestSignature: text("newest_signature"),
  oldestSignature: text("oldest_signature"),
  backfillComplete: boolean("backfill_complete").notNull().default(false),
  indexedCount: integer("indexed_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastFailureReason: text("last_failure_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Derived index of a registered wallet's signatures; the chain stays authoritative. */
export const indexedTransactions = pgTable(
  "indexed_transactions",
  {
    id: primaryId(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => managedWallets.id, { onDelete: "restrict" }),
    cluster: clusterEnum("cluster").notNull(),
    signature: text("signature").notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }),
    status: text("status").notNull(),
    confirmationStatus: text("confirmation_status"),
    /** Untrusted on-chain text; sanitized when rendered. */
    memo: text("memo"),
    feeLamports: numeric("fee_lamports", { precision: 39, scale: 0 }),
    solChangeLamports: numeric("sol_change_lamports", { precision: 39, scale: 0 }),
    detailsRetrievedAt: timestamp("details_retrieved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("indexed_transactions_wallet_signature_unique").on(table.walletId, table.signature),
    index("indexed_transactions_wallet_slot_idx").on(table.walletId, table.slot),
    check("indexed_transactions_status_check", sql`${table.status} in ('succeeded', 'failed')`),
  ],
);
