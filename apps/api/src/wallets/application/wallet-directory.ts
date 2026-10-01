import { createHash } from "node:crypto";
import type { Address } from "@solana/kit";
import type { PermittedCluster } from "@sct/network";
import { available, fromCache, isProviderError, unavailableFromProviderError } from "@sct/providers";
import type { ReadContext } from "@sct/solana";
import type {
  ManagedWallet,
  Sourced,
  UpdateWalletRequest,
  WalletList,
  WalletListQuery,
} from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields } from "../../auth/application/actor";
import type { UnitOfWork } from "../../auth/application/ports";
import { isCategoryAllowed, MAX_ACTIVE_WALLETS_PER_ORGANIZATION } from "../domain/managed-wallet";
import { toManagedWallet } from "./managed-wallet-view";
import type { BalanceCache, WalletBalanceReader, WalletChanges, WalletStore } from "./registry-ports";
import type { OrganizationActor } from "./wallet-registration";

export const BALANCE_CACHE_TTL_MS = 10_000;

export type UpdateFailure =
  | { code: "WALLET_NOT_FOUND" }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "OPERATION_NOT_ALLOWED"; message: string };

type BalanceRows = { address: string; lamports: string }[];

/** SPEC-009 §4.3–4.5 — listing, detail, and metadata updates. */
export class WalletDirectory {
  constructor(
    private readonly config: { cluster: PermittedCluster },
    private readonly deps: {
      unitOfWork: UnitOfWork;
      wallets: WalletStore;
      balances: WalletBalanceReader;
      balanceCache: BalanceCache;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  /** WRG-AC-06 */
  async list(
    actor: OrganizationActor,
    query: WalletListQuery,
    context: ReadContext,
  ): Promise<{ list: WalletList; nextCursor: string | null }> {
    const records = await this.deps.wallets.list({
      organizationId: actor.organizationId,
      cluster: this.config.cluster,
      status: query.status,
      category: query.category,
      custodyType: query.custodyType,
      tag: query.tag,
      search: query.q,
      limit: query.limit + 1,
      cursor: query.cursor,
    });
    const page = records.slice(0, query.limit);
    const nextCursor = records.length > query.limit ? (page.at(-1)?.id ?? null) : null;
    const balances = await this.readBalances(
      page.map((record) => record.address as Address),
      context,
    );
    const idByAddress = new Map(page.map((record) => [record.address, record.id]));
    return {
      list: {
        wallets: page.map((record) => toManagedWallet(record, actor.userId)),
        balances:
          balances.status === "UNAVAILABLE"
            ? balances
            : {
                ...balances,
                value: balances.value.flatMap((row) => {
                  const walletId = idByAddress.get(row.address);
                  return walletId ? [{ walletId, lamports: row.lamports }] : [];
                }),
              },
      },
      nextCursor,
    };
  }

  /** WRG-AC-07 */
  async get(actor: OrganizationActor, walletId: string): Promise<ManagedWallet | null> {
    const record = await this.deps.wallets.find(actor.organizationId, this.config.cluster, walletId);
    return record ? toManagedWallet(record, actor.userId) : null;
  }

  /** WRG-AC-08 */
  async update(
    actor: OrganizationActor,
    walletId: string,
    request: UpdateWalletRequest,
  ): Promise<{ ok: true; wallet: ManagedWallet } | { ok: false; failure: UpdateFailure }> {
    const cluster = this.config.cluster;
    const now = this.deps.now?.() ?? new Date();
    const failure = await this.deps.unitOfWork.run(async (transaction): Promise<UpdateFailure | null> => {
      if (!(await this.deps.wallets.lock(actor.organizationId, cluster, walletId, transaction))) {
        return { code: "WALLET_NOT_FOUND" };
      }
      const current = await this.deps.wallets.find(actor.organizationId, cluster, walletId, transaction);
      if (!current) return { code: "WALLET_NOT_FOUND" };
      if (request.category && !isCategoryAllowed(request.category, current.custodyType)) {
        return { code: "VALIDATION_FAILED", message: "The WATCH_ONLY category requires watch-only custody." };
      }
      if (request.status === "active" && current.status === "archived") {
        const active = await this.deps.wallets.countActive(actor.organizationId, cluster, transaction);
        if (active >= MAX_ACTIVE_WALLETS_PER_ORGANIZATION) {
          return {
            code: "OPERATION_NOT_ALLOWED",
            message: `An organization can hold at most ${MAX_ACTIVE_WALLETS_PER_ORGANIZATION} active wallets.`,
          };
        }
      }

      const changes: WalletChanges = { updatedAt: now };
      const fields: Array<"label" | "purpose" | "category" | "tags" | "notes" | "status"> = [];
      if (request.label !== undefined && request.label !== current.label) {
        changes.label = request.label;
        fields.push("label");
      }
      if (request.purpose !== undefined && request.purpose !== current.purpose) {
        changes.purpose = request.purpose;
        fields.push("purpose");
      }
      if (request.category !== undefined && request.category !== current.category) {
        changes.category = request.category;
        fields.push("category");
      }
      if (request.notes !== undefined && request.notes !== current.notes) {
        changes.notes = request.notes;
        fields.push("notes");
      }
      if (request.tags !== undefined && !sameTags(request.tags, current.tags)) {
        changes.tags = request.tags;
        fields.push("tags");
      }
      if (request.status !== undefined && request.status !== current.status) {
        changes.status = request.status;
        changes.archivedAt = request.status === "archived" ? now : null;
        fields.push("status");
      }
      if (fields.length === 0) return null;

      await this.deps.wallets.update(walletId, changes, transaction);
      await this.deps.audit.record(
        {
          action: "wallet.updated",
          resourceType: "wallet",
          resourceId: walletId,
          result: "success",
          cluster,
          ...actorAuditFields(actor),
          metadata: {
            address: current.address,
            fields,
            ...(changes.status ? { status: changes.status } : {}),
          },
        },
        transaction,
      );
      return null;
    });
    if (failure) return { ok: false, failure };
    const wallet = await this.get(actor, walletId);
    if (!wallet) return { ok: false, failure: { code: "WALLET_NOT_FOUND" } };
    return { ok: true, wallet };
  }

  private async readBalances(addresses: Address[], context: ReadContext): Promise<Sourced<BalanceRows>> {
    const source = `solana-rpc-${this.config.cluster}`;
    const sorted = [...new Set(addresses)].sort();
    const key = `${this.config.cluster}:${createHash("sha256").update(sorted.join(",")).digest("hex")}`;
    const cached = await this.deps.balanceCache.get(key);
    if (cached) return fromCache(cached);
    try {
      const value: Sourced<BalanceRows> =
        sorted.length === 0
          ? await this.emptyReading(context)
          : await this.deps.balances.read(sorted, context).then((reading) =>
              available(
                reading.value.map((row) => ({ address: row.address, lamports: row.lamports.toString() })),
                reading.provenance,
              ),
            );
      if (value.status !== "UNAVAILABLE" && sorted.length > 0) {
        await Promise.all([
          this.deps.balanceCache.set(key, value, BALANCE_CACHE_TTL_MS),
          this.deps.balanceCache.setLastSuccess(key, value.provenance.retrievedAt),
        ]);
      }
      return value;
    } catch (error) {
      if (!isProviderError(error)) throw error;
      return unavailableFromProviderError(error, {
        source,
        sourceType: "rpc",
        lastSuccessfulRetrievalAt: await this.deps.balanceCache.getLastSuccess(key),
      });
    }
  }

  /** An empty page needs no RPC call; the value is derived, not read. */
  private async emptyReading(context: ReadContext): Promise<Sourced<BalanceRows>> {
    const now = (this.deps.now?.() ?? new Date()).toISOString();
    return available([], {
      source: "wallet-registry",
      sourceType: "derived",
      provider: "solana-corporate-terminal",
      endpoint: "",
      network: this.config.cluster,
      retrievedAt: now,
      observedAt: null,
      requestId: context.requestId,
      dataVersion: "multiple-balances.v1",
      confidence: "DERIVED",
      fallbackUsed: false,
    });
  }
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(right);
  return left.every((tag) => set.has(tag));
}
