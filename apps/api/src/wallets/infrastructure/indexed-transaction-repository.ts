import { and, desc, eq, lt, or, schema, type Database } from "@sct/database";
import type { IndexedTransaction } from "@sct/validation";
import type { IndexedTransactionRecord, IndexedTransactionStore } from "../application/registry-ports";

export class IndexedTransactionRepository implements IndexedTransactionStore {
  constructor(private readonly db: Database) {}

  async list(
    walletId: string,
    limit: number,
    after: { slot: bigint; id: string } | null,
  ): Promise<IndexedTransactionRecord[]> {
    const table = schema.indexedTransactions;
    const rows = await this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.walletId, walletId),
          after
            ? or(lt(table.slot, after.slot), and(eq(table.slot, after.slot), lt(table.id, after.id)))
            : undefined,
        ),
      )
      .orderBy(desc(table.slot), desc(table.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      signature: row.signature,
      slot: row.slot,
      blockTime: row.blockTime,
      status: row.status as IndexedTransaction["status"],
      confirmationStatus: row.confirmationStatus as IndexedTransaction["confirmationStatus"],
      memo: row.memo,
      feeLamports: row.feeLamports === null ? null : BigInt(row.feeLamports),
      solChangeLamports: row.solChangeLamports === null ? null : BigInt(row.solChangeLamports),
    }));
  }
}
