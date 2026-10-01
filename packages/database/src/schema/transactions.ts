import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  index,
  jsonb,
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
import { managedWallets } from "./wallets";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * SPEC-004 §3 — one transaction from intent to reconciliation. `state` changes only
 * through the domain transition function (compare-and-set on the current state).
 * JSON columns are validated with Zod at the boundary.
 */
export const transactionRecords = pgTable(
  "transaction_records",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    initiatedByUserId: uuid("initiated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => managedWallets.id, { onDelete: "restrict" }),
    cluster: clusterEnum("cluster").notNull(),
    purpose: text("purpose").notNull(),
    state: text("state").notNull(),
    feePayer: text("fee_payer").notNull(),
    signers: jsonb("signers").$type<string[]>().notNull(),
    /** The request as the user expressed it (e.g. destination and amount), for display. */
    intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
    expectedEffects: jsonb("expected_effects").$type<Record<string, unknown>>().notNull(),
    review: jsonb("review").$type<Record<string, unknown>>(),
    simulationResult: jsonb("simulation_result").$type<Record<string, unknown>>(),
    messageBytes: bytea("message_bytes").notNull(),
    messageHash: bytea("message_hash").notNull(),
    unsignedTransaction: bytea("unsigned_transaction").notNull(),
    signedTransaction: bytea("signed_transaction"),
    recentBlockhash: text("recent_blockhash").notNull(),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "bigint" }).notNull(),
    signature: text("signature"),
    failure: jsonb("failure").$type<Record<string, unknown>>(),
    reconciliation: jsonb("reconciliation").$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key").notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("transaction_records_signature_unique").on(table.signature),
    index("transaction_records_org_created_idx").on(table.organizationId, table.createdAt),
    index("transaction_records_wallet_idx").on(table.walletId),
    // Sweeps read only records that are still moving.
    index("transaction_records_open_state_idx")
      .on(table.state)
      .where(sql`${table.state} in ('SUBMITTED', 'CONFIRMING', 'CONFIRMED', 'RECONCILIATION_REQUIRED')`),
  ],
);

/** Append-only history of state changes (SPEC-004 §3 `stateHistory`). */
export const transactionStateTransitions = pgTable(
  "transaction_state_transitions",
  {
    id: primaryId(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactionRecords.id, { onDelete: "restrict" }),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    requestId: text("request_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("transaction_state_transitions_tx_idx").on(table.transactionId, table.occurredAt)],
);

/** Idempotent request keys (prompt §2001): one resource per (organization, user, scope, key). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId, table.scope, table.key] })],
);
