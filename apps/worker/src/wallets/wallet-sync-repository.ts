import { and, asc, count, desc, eq, isNull, schema, sql, type Database } from "@sct/database";
import type { Cluster } from "@sct/network";
import type { SignatureSummary } from "@sct/solana";
import type { SyncedWallet, WalletSyncStore } from "./wallet-sync-job";

export class WalletSyncRepository implements WalletSyncStore {
  constructor(private readonly db: Database) {}

  async listDue(cluster: Cluster, limit: number): Promise<{ id: string }[]> {
    return this.db
      .select({ id: schema.managedWallets.id })
      .from(schema.managedWallets)
      .innerJoin(schema.walletSyncState, eq(schema.walletSyncState.walletId, schema.managedWallets.id))
      .where(and(eq(schema.managedWallets.cluster, cluster), eq(schema.managedWallets.status, "active")))
      .orderBy(sql`${schema.walletSyncState.lastAttemptAt} asc nulls first`, asc(schema.managedWallets.id))
      .limit(limit);
  }

  async load(walletId: string, cluster: Cluster): Promise<SyncedWallet | null> {
    const [row] = await this.db
      .select({
        id: schema.managedWallets.id,
        address: schema.managedWallets.address,
        cluster: schema.managedWallets.cluster,
        newestSignature: schema.walletSyncState.newestSignature,
        oldestSignature: schema.walletSyncState.oldestSignature,
        backfillComplete: schema.walletSyncState.backfillComplete,
      })
      .from(schema.managedWallets)
      .innerJoin(schema.walletSyncState, eq(schema.walletSyncState.walletId, schema.managedWallets.id))
      .where(
        and(
          eq(schema.managedWallets.id, walletId),
          eq(schema.managedWallets.cluster, cluster),
          eq(schema.managedWallets.status, "active"),
        ),
      );
    return row ?? null;
  }

  async markAttempt(walletId: string, at: Date): Promise<void> {
    await this.db
      .update(schema.walletSyncState)
      .set({ lastAttemptAt: at })
      .where(eq(schema.walletSyncState.walletId, walletId));
  }

  async upsertSignatures(walletId: string, cluster: Cluster, entries: SignatureSummary[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(schema.indexedTransactions)
      .values(
        entries.map((entry) => ({
          walletId,
          cluster,
          signature: entry.signature,
          slot: entry.slot,
          blockTime: entry.blockTime === null ? null : new Date(Number(entry.blockTime) * 1000),
          status: entry.failed ? "failed" : "succeeded",
          confirmationStatus: entry.confirmationStatus,
          memo: entry.memo,
        })),
      )
      .onConflictDoNothing({
        target: [schema.indexedTransactions.walletId, schema.indexedTransactions.signature],
      });
  }

  async pendingDetails(walletId: string, limit: number): Promise<{ id: string; signature: string }[]> {
    return this.db
      .select({ id: schema.indexedTransactions.id, signature: schema.indexedTransactions.signature })
      .from(schema.indexedTransactions)
      .where(
        and(
          eq(schema.indexedTransactions.walletId, walletId),
          isNull(schema.indexedTransactions.detailsRetrievedAt),
        ),
      )
      .orderBy(desc(schema.indexedTransactions.slot))
      .limit(limit);
  }

  async saveDetails(
    rowId: string,
    details: { feeLamports: bigint; solChangeLamports: bigint | null; at: Date },
  ): Promise<void> {
    await this.db
      .update(schema.indexedTransactions)
      .set({
        feeLamports: details.feeLamports.toString(),
        solChangeLamports: details.solChangeLamports === null ? null : details.solChangeLamports.toString(),
        detailsRetrievedAt: details.at,
      })
      .where(eq(schema.indexedTransactions.id, rowId));
  }

  async countIndexed(walletId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.indexedTransactions)
      .where(eq(schema.indexedTransactions.walletId, walletId));
    return row?.value ?? 0;
  }

  async recordSuccess(
    walletId: string,
    state: {
      newestSignature: string | null;
      oldestSignature: string | null;
      backfillComplete: boolean;
      indexedCount: number;
      at: Date;
    },
  ): Promise<void> {
    await this.db
      .update(schema.walletSyncState)
      .set({
        newestSignature: state.newestSignature,
        oldestSignature: state.oldestSignature,
        backfillComplete: state.backfillComplete,
        indexedCount: state.indexedCount,
        lastSuccessAt: state.at,
      })
      .where(eq(schema.walletSyncState.walletId, walletId));
  }

  async recordFailure(walletId: string, reason: string, at: Date): Promise<void> {
    await this.db
      .update(schema.walletSyncState)
      .set({ lastFailureAt: at, lastFailureReason: reason.slice(0, 200) })
      .where(eq(schema.walletSyncState.walletId, walletId));
  }
}
