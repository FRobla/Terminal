import { TRANSACTION_CONFIRMATION_QUEUE, TRANSACTION_CONFIRMATION_SWEEP_JOB } from "@sct/config";
import { and, desc, eq, lt, schema, type Database } from "@sct/database";
import type { TransactionListQuery } from "@sct/validation";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type {
  ConfirmationScheduler,
  IdempotencyStore,
  TransactionDirectory,
  TransactionListing,
} from "../application/ports";

export class IdempotencyRepository implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async find(key: { organizationId: string; userId: string; scope: string; key: string }) {
    const [row] = await this.db
      .select({
        requestHash: schema.idempotencyKeys.requestHash,
        resourceId: schema.idempotencyKeys.resourceId,
      })
      .from(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.organizationId, key.organizationId),
          eq(schema.idempotencyKeys.userId, key.userId),
          eq(schema.idempotencyKeys.scope, key.scope),
          eq(schema.idempotencyKeys.key, key.key),
        ),
      );
    return row ?? null;
  }

  async claim(
    entry: {
      organizationId: string;
      userId: string;
      scope: string;
      key: string;
      requestHash: string;
      resourceId: string;
    },
    transaction: unknown,
  ): Promise<boolean> {
    const rows = await (transaction as Database)
      .insert(schema.idempotencyKeys)
      .values(entry)
      .onConflictDoNothing()
      .returning({ key: schema.idempotencyKeys.key });
    return rows.length > 0;
  }
}

export class TransactionDirectoryRepository implements TransactionDirectory {
  constructor(private readonly db: Database) {}

  async list(organizationId: string, cluster: string, query: TransactionListQuery): Promise<string[]> {
    const table = schema.transactionRecords;
    const conditions = [eq(table.organizationId, organizationId), eq(table.cluster, cluster as never)];
    if (query.walletId) conditions.push(eq(table.walletId, query.walletId));
    if (query.state) conditions.push(eq(table.state, query.state));
    if (query.cursor) conditions.push(lt(table.id, query.cursor));
    const rows = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(...conditions))
      .orderBy(desc(table.id))
      .limit(query.limit);
    return rows.map((row) => row.id);
  }

  async describe(transactionId: string): Promise<TransactionListing | null> {
    const [row] = await this.db
      .select({
        id: schema.transactionRecords.id,
        walletLabel: schema.managedWallets.label,
        userId: schema.users.id,
        displayName: schema.users.displayName,
      })
      .from(schema.transactionRecords)
      .innerJoin(schema.managedWallets, eq(schema.managedWallets.id, schema.transactionRecords.walletId))
      .innerJoin(schema.users, eq(schema.users.id, schema.transactionRecords.initiatedByUserId))
      .where(eq(schema.transactionRecords.id, transactionId));
    return row
      ? {
          id: row.id,
          walletLabel: row.walletLabel,
          initiatedBy: { id: row.userId, displayName: row.displayName },
        }
      : null;
  }
}

/** Enqueues an immediate confirmation sweep for the worker; the job id deduplicates bursts. */
export class BullmqConfirmationScheduler implements ConfirmationScheduler {
  private queue: Queue | undefined;

  constructor(private readonly redis: Redis) {}

  async requestSweep(transactionId: string): Promise<void> {
    this.queue ??= new Queue(TRANSACTION_CONFIRMATION_QUEUE, { connection: this.redis });
    await this.queue.add(
      TRANSACTION_CONFIRMATION_SWEEP_JOB,
      { transactionId },
      { jobId: `confirm-${transactionId}`, attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
    );
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }
}
