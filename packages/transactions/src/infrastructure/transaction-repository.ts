import { createHash } from "node:crypto";
import { and, asc, eq, inArray, schema, type Database } from "@sct/database";
import type { Cluster } from "@sct/network";
import type { TransactionState } from "@sct/validation";
import type {
  DatabaseTransaction,
  NewTransactionRecord,
  StateChangeRecord,
  TransactionPatch,
  TransactionRecord,
  TransactionStore,
  UnitOfWork,
} from "../application/ports";

type Row = typeof schema.transactionRecords.$inferSelect;

const toBuffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function toRecord(row: Row): TransactionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    initiatedByUserId: row.initiatedByUserId,
    walletId: row.walletId,
    cluster: row.cluster,
    purpose: row.purpose as TransactionRecord["purpose"],
    state: row.state as TransactionState,
    feePayer: row.feePayer,
    signers: row.signers,
    intent: row.intent as TransactionRecord["intent"],
    expectedEffects: row.expectedEffects as Record<string, string>,
    review: row.review ?? null,
    simulationResult: row.simulationResult ?? null,
    messageBytes: new Uint8Array(row.messageBytes),
    messageHash: new Uint8Array(row.messageHash),
    unsignedTransaction: new Uint8Array(row.unsignedTransaction),
    signedTransaction: row.signedTransaction ? new Uint8Array(row.signedTransaction) : null,
    recentBlockhash: row.recentBlockhash,
    lastValidBlockHeight: row.lastValidBlockHeight,
    signature: row.signature,
    failure: (row.failure as TransactionRecord["failure"]) ?? null,
    reconciliation: row.reconciliation ?? null,
    idempotencyKey: row.idempotencyKey,
    lastSentAt: row.lastSentAt,
    submittedAt: row.submittedAt,
    confirmedAt: row.confirmedAt,
    finalizedAt: row.finalizedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** SHA-256 of the compiled message: what the review describes and the signer must sign (SPEC-004 rule 5). */
export function messageHash(messageBytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(messageBytes).digest());
}

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx));
  }
}

export class TransactionRepository implements TransactionStore {
  constructor(private readonly db: Database) {}

  private executor(transaction?: DatabaseTransaction): Database {
    return (transaction as Database | undefined) ?? this.db;
  }

  async insert(record: NewTransactionRecord, transaction: DatabaseTransaction): Promise<string> {
    const [row] = await this.executor(transaction)
      .insert(schema.transactionRecords)
      .values({
        organizationId: record.organizationId,
        initiatedByUserId: record.initiatedByUserId,
        walletId: record.walletId,
        cluster: record.cluster,
        purpose: record.purpose,
        state: "DRAFT",
        feePayer: record.feePayer,
        signers: record.signers,
        intent: record.intent,
        expectedEffects: record.expectedEffects,
        messageBytes: toBuffer(record.messageBytes),
        messageHash: toBuffer(record.messageHash),
        unsignedTransaction: toBuffer(record.unsignedTransaction),
        recentBlockhash: record.recentBlockhash,
        lastValidBlockHeight: record.lastValidBlockHeight,
        idempotencyKey: record.idempotencyKey,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      })
      .returning({ id: schema.transactionRecords.id });
    if (!row) throw new Error("Failed to persist the transaction record");
    return row.id;
  }

  async find(transactionId: string, transaction?: DatabaseTransaction): Promise<TransactionRecord | null> {
    const [row] = await this.executor(transaction)
      .select()
      .from(schema.transactionRecords)
      .where(eq(schema.transactionRecords.id, transactionId));
    return row ? toRecord(row) : null;
  }

  async compareAndSet(
    transactionId: string,
    from: TransactionState,
    to: TransactionState,
    patch: TransactionPatch,
    at: Date,
    transaction: DatabaseTransaction,
  ): Promise<boolean> {
    const { signedTransaction, ...rest } = patch;
    const rows = await this.executor(transaction)
      .update(schema.transactionRecords)
      .set({
        ...rest,
        ...(signedTransaction !== undefined
          ? { signedTransaction: signedTransaction === null ? null : toBuffer(signedTransaction) }
          : {}),
        state: to,
        updatedAt: at,
      })
      .where(and(eq(schema.transactionRecords.id, transactionId), eq(schema.transactionRecords.state, from)))
      .returning({ id: schema.transactionRecords.id });
    return rows.length > 0;
  }

  async appendStateChange(
    transactionId: string,
    change: StateChangeRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.executor(transaction).insert(schema.transactionStateTransitions).values({
      transactionId,
      fromState: change.fromState,
      toState: change.toState,
      occurredAt: change.occurredAt,
      requestId: change.requestId,
      details: change.details,
    });
  }

  async history(transactionId: string): Promise<StateChangeRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.transactionStateTransitions)
      .where(eq(schema.transactionStateTransitions.transactionId, transactionId))
      .orderBy(
        asc(schema.transactionStateTransitions.occurredAt),
        asc(schema.transactionStateTransitions.id),
      );
    return rows.map((row) => ({
      fromState: row.fromState as TransactionState | null,
      toState: row.toState as TransactionState,
      occurredAt: row.occurredAt,
      requestId: row.requestId,
      details: row.details,
    }));
  }

  async listInStates(
    states: readonly TransactionState[],
    cluster: Cluster,
    limit: number,
  ): Promise<TransactionRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.transactionRecords)
      .where(
        and(
          inArray(schema.transactionRecords.state, [...states]),
          eq(schema.transactionRecords.cluster, cluster),
        ),
      )
      .orderBy(asc(schema.transactionRecords.updatedAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  async touch(transactionId: string, patch: Pick<TransactionPatch, "lastSentAt">): Promise<void> {
    await this.db
      .update(schema.transactionRecords)
      .set(patch)
      .where(eq(schema.transactionRecords.id, transactionId));
  }
}
