import type { Address } from "@solana/kit";
import type { Cluster } from "@sct/network";
import type { Logger } from "@sct/observability";
import { isProviderError } from "@sct/providers";
import {
  solChangeOf,
  type ReadContext,
  type RpcReading,
  type SignatureSummary,
  type TransactionDetails,
} from "@sct/solana";

/** SPEC-009 §4.8 — limits of one wallet sync run. */
export const SYNC_PAGE_SIZE = 100;
export const MAX_NEW_SIGNATURES_PER_RUN = 500;
export const BACKFILL_CAP = 1000;
export const DETAILS_PER_RUN = 10;
export const WALLETS_PER_SWEEP = 20;
export const SWEEP_INTERVAL_MS = 60_000;

export interface SyncedWallet {
  id: string;
  address: string;
  cluster: Cluster;
  newestSignature: string | null;
  oldestSignature: string | null;
  backfillComplete: boolean;
}

export interface WalletSyncStore {
  /** Active wallets on the cluster, least recently attempted first. */
  listDue(cluster: Cluster, limit: number): Promise<{ id: string }[]>;
  /** The wallet when it is active on the cluster, otherwise null. */
  load(walletId: string, cluster: Cluster): Promise<SyncedWallet | null>;
  markAttempt(walletId: string, at: Date): Promise<void>;
  /** Inserts signatures; existing `(wallet, signature)` rows are left unchanged. */
  upsertSignatures(walletId: string, cluster: Cluster, entries: SignatureSummary[]): Promise<void>;
  pendingDetails(walletId: string, limit: number): Promise<{ id: string; signature: string }[]>;
  saveDetails(
    rowId: string,
    details: { feeLamports: bigint; solChangeLamports: bigint | null; at: Date },
  ): Promise<void>;
  countIndexed(walletId: string): Promise<number>;
  recordSuccess(
    walletId: string,
    state: {
      newestSignature: string | null;
      oldestSignature: string | null;
      backfillComplete: boolean;
      indexedCount: number;
      at: Date;
    },
  ): Promise<void>;
  recordFailure(walletId: string, reason: string, at: Date): Promise<void>;
}

export interface WalletSyncReaders {
  signatures: {
    readPage(
      address: Address,
      page: { limit: number; before?: string | undefined; until?: string | undefined },
      context: ReadContext,
    ): Promise<RpcReading<SignatureSummary[]>>;
  };
  details: {
    read(
      signature: string,
      commitment: "confirmed" | "finalized",
      context: ReadContext,
    ): Promise<RpcReading<TransactionDetails | null>>;
  };
}

export interface WalletSyncScheduler {
  enqueue(walletId: string, jobId: string): Promise<void>;
}

/** Incremental, idempotent indexing of registered wallets' signatures (SPEC-009 WRG-AC-11, WRG-AC-12). */
export class WalletSyncJob {
  constructor(
    private readonly config: { cluster: Cluster },
    private readonly deps: {
      store: WalletSyncStore;
      readers: WalletSyncReaders;
      scheduler: WalletSyncScheduler;
      logger: Logger;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Enqueues one deterministic job per due wallet; reruns within the same minute enqueue nothing new. */
  async sweep(): Promise<number> {
    const due = await this.deps.store.listDue(this.config.cluster, WALLETS_PER_SWEEP);
    const window = Math.floor(this.now().getTime() / SWEEP_INTERVAL_MS);
    for (const wallet of due) await this.deps.scheduler.enqueue(wallet.id, `sync-${wallet.id}-${window}`);
    return due.length;
  }

  async syncWallet(
    walletId: string,
    context: ReadContext,
  ): Promise<{ indexed: number; details: number } | null> {
    const wallet = await this.deps.store.load(walletId, this.config.cluster);
    if (!wallet) return null;
    await this.deps.store.markAttempt(walletId, this.now());
    try {
      return await this.run(wallet, context);
    } catch (error) {
      const reason = isProviderError(error) ? `RPC ${error.kind}` : "UNEXPECTED";
      await this.deps.store.recordFailure(walletId, reason, this.now());
      this.deps.logger.warn({ err: error, walletId }, "Wallet sync failed");
      throw error;
    }
  }

  private async run(wallet: SyncedWallet, context: ReadContext) {
    const address = wallet.address as Address;
    const store = this.deps.store;
    let newest = wallet.newestSignature;
    let oldest = wallet.oldestSignature;
    let backfillComplete = wallet.backfillComplete;

    // 1. New signatures, newest first, down to the last known newest signature.
    let before: string | undefined;
    let fetched = 0;
    let firstPage = true;
    for (;;) {
      const page = await this.deps.readers.signatures.readPage(
        address,
        { limit: SYNC_PAGE_SIZE, before, until: wallet.newestSignature ?? undefined },
        context,
      );
      const entries = page.value;
      if (entries.length > 0) {
        await store.upsertSignatures(wallet.id, wallet.cluster, entries);
        if (firstPage) newest = entries[0]?.signature ?? newest;
        if (wallet.newestSignature === null) oldest = entries.at(-1)?.signature ?? oldest;
      }
      firstPage = false;
      fetched += entries.length;
      if (entries.length < SYNC_PAGE_SIZE) {
        // A first sync that saw the whole history has nothing to backfill.
        if (wallet.newestSignature === null) backfillComplete = true;
        break;
      }
      if (fetched >= MAX_NEW_SIGNATURES_PER_RUN) break;
      before = entries.at(-1)?.signature;
    }

    // 2. One page of older history, up to the backfill cap.
    let indexed = await store.countIndexed(wallet.id);
    if (!backfillComplete && oldest && indexed < BACKFILL_CAP) {
      const limit = Math.min(SYNC_PAGE_SIZE, BACKFILL_CAP - indexed);
      const page = await this.deps.readers.signatures.readPage(address, { limit, before: oldest }, context);
      if (page.value.length > 0) {
        await store.upsertSignatures(wallet.id, wallet.cluster, page.value);
        oldest = page.value.at(-1)?.signature ?? oldest;
      }
      if (page.value.length < limit) backfillComplete = true;
      indexed = await store.countIndexed(wallet.id);
    }
    if (indexed >= BACKFILL_CAP) backfillComplete = true;

    // 3. Fee and SOL change for the newest rows without details. Details are best effort:
    // a provider failure here (often the shared budget) leaves them for the next run.
    let details = 0;
    try {
      for (const row of await store.pendingDetails(wallet.id, DETAILS_PER_RUN)) {
        const reading = await this.deps.readers.details.read(row.signature, "confirmed", context);
        if (!reading.value) continue;
        await store.saveDetails(row.id, {
          feeLamports: reading.value.feeLamports,
          solChangeLamports: solChangeOf(reading.value, wallet.address),
          at: this.now(),
        });
        details += 1;
      }
    } catch (error) {
      if (!isProviderError(error)) throw error;
      this.deps.logger.info(
        { walletId: wallet.id, kind: error.kind },
        "Transaction details deferred to the next sync",
      );
    }

    await store.recordSuccess(wallet.id, {
      newestSignature: newest,
      oldestSignature: oldest,
      backfillComplete,
      indexedCount: indexed,
      at: this.now(),
    });
    return { indexed, details };
  }
}
