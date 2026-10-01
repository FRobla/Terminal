import type { PermittedCluster } from "@sct/network";
import type { WalletHistory } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields } from "../../auth/application/actor";
import { WALLET_BACKFILL_CAP } from "../domain/managed-wallet";
import { decodeHistoryCursor, encodeHistoryCursor } from "../domain/history-cursor";
import { sanitizeUntrustedText } from "../domain/untrusted-text";
import { toWalletSyncState } from "./managed-wallet-view";
import type {
  IndexedTransactionStore,
  SyncRequestThrottle,
  WalletStore,
  WalletSyncScheduler,
} from "./registry-ports";
import type { OrganizationActor } from "./wallet-registration";

/** Minimum time between manual sync requests for one wallet (WRG-AC-14). */
export const MANUAL_SYNC_WINDOW_MS = 30_000;

/** SPEC-009 §4.7–4.8 — indexed history and manual synchronization requests. */
export class WalletHistoryService {
  constructor(
    private readonly config: { cluster: PermittedCluster },
    private readonly deps: {
      wallets: WalletStore;
      transactions: IndexedTransactionStore;
      syncScheduler: WalletSyncScheduler;
      throttle: SyncRequestThrottle;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  /** WRG-AC-13. Returns null when the wallet is not in the caller's organization. */
  async history(
    actor: OrganizationActor,
    walletId: string,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<{ history: WalletHistory; nextCursor: string | null } | null> {
    const wallet = await this.deps.wallets.find(actor.organizationId, this.config.cluster, walletId);
    if (!wallet) return null;
    const after = query.cursor ? decodeHistoryCursor(query.cursor) : null;
    const rows = await this.deps.transactions.list(walletId, query.limit + 1, after);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      history: {
        transactions: page.map((row) => ({
          signature: row.signature,
          slot: row.slot.toString(),
          blockTime: row.blockTime ? row.blockTime.toISOString() : null,
          status: row.status,
          confirmationStatus: row.confirmationStatus,
          memo: row.memo === null ? null : sanitizeUntrustedText(row.memo),
          feeLamports: row.feeLamports === null ? null : row.feeLamports.toString(),
          solChangeLamports: row.solChangeLamports === null ? null : row.solChangeLamports.toString(),
        })),
        sync: toWalletSyncState(wallet.sync),
        backfillCap: WALLET_BACKFILL_CAP,
      },
      nextCursor:
        rows.length > query.limit && last ? encodeHistoryCursor({ slot: last.slot, id: last.id }) : null,
    };
  }

  /** WRG-AC-14. Returns null when the wallet is not in the caller's organization. */
  async requestSync(
    actor: OrganizationActor,
    walletId: string,
  ): Promise<{ enqueued: boolean; retryAfterMs: number | null } | null> {
    const wallet = await this.deps.wallets.find(actor.organizationId, this.config.cluster, walletId);
    if (!wallet) return null;
    if (wallet.status !== "active") return { enqueued: false, retryAfterMs: null };
    const retryAfterMs = await this.deps.throttle.acquire(walletId, MANUAL_SYNC_WINDOW_MS);
    if (retryAfterMs > 0) return { enqueued: false, retryAfterMs };
    const now = this.deps.now?.() ?? new Date();
    await this.deps.syncScheduler.enqueue(
      walletId,
      `sync-${walletId}-manual-${Math.floor(now.getTime() / MANUAL_SYNC_WINDOW_MS)}`,
    );
    await this.deps.audit.record({
      action: "wallet.sync_requested",
      resourceType: "wallet",
      resourceId: walletId,
      result: "success",
      cluster: this.config.cluster,
      ...actorAuditFields(actor),
      metadata: { address: wallet.address },
    });
    return { enqueued: true, retryAfterMs: null };
  }
}
