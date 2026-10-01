import type { Address } from "@solana/kit";
import { explorerAddressUrl, type Cluster } from "@sct/network";
import { available, fromCache, isProviderError, unavailableFromProviderError } from "@sct/providers";
import type { ReadContext, RpcReading, SignatureSummary, SolBalance, TokenAccountHolding } from "@sct/solana";
import type { Sourced, WalletOverview } from "@sct/validation";
import {
  sortTokenAccounts,
  toLamportsValue,
  toRecentTransaction,
  toTokenAccount,
} from "../domain/wallet-overview";

export interface WalletReaders {
  solBalance: { read(address: Address, context: ReadContext): Promise<RpcReading<SolBalance>> };
  tokenAccounts: { read(address: Address, context: ReadContext): Promise<RpcReading<TokenAccountHolding[]>> };
  signatures: {
    read(address: Address, limit: number, context: ReadContext): Promise<RpcReading<SignatureSummary[]>>;
  };
}

/** Short-lived cache of successful sections plus the last successful retrieval time per section. */
export interface OverviewSectionCache {
  get<T>(key: string): Promise<Sourced<T> | null>;
  set<T>(key: string, value: Sourced<T>, ttlMs: number): Promise<void>;
  getLastSuccess(key: string): Promise<string | null>;
  setLastSuccess(key: string, retrievedAt: string): Promise<void>;
}

export const OVERVIEW_CACHE_TTL_MS = 10_000;

/**
 * SPEC-002 §4.2 — builds the Wallet Overview from real RPC data. Each section is
 * independent: a failed section becomes UNAVAILABLE without failing the others.
 */
export class GetWalletOverview {
  constructor(
    private readonly cluster: Cluster,
    private readonly readers: WalletReaders,
    private readonly cache: OverviewSectionCache,
  ) {}

  async execute(address: Address, signaturesLimit: number, context: ReadContext): Promise<WalletOverview> {
    const source = `solana-rpc-${this.cluster}`;
    const key = (section: string) => `${this.cluster}:${address}:${section}`;

    const [solBalance, tokenAccounts, recentTransactions] = await Promise.all([
      this.section(key("sol-balance"), source, async () => {
        const reading = await this.readers.solBalance.read(address, context);
        return available(toLamportsValue(reading.value), reading.provenance);
      }),
      this.section(key("token-accounts"), source, async () => {
        const reading = await this.readers.tokenAccounts.read(address, context);
        return available(sortTokenAccounts(reading.value.map(toTokenAccount)), reading.provenance);
      }),
      this.section(key(`signatures:${signaturesLimit}`), source, async () => {
        const reading = await this.readers.signatures.read(address, signaturesLimit, context);
        return available(
          reading.value.map((summary) => toRecentTransaction(summary, this.cluster)),
          reading.provenance,
        );
      }),
    ]);

    return {
      address,
      cluster: this.cluster,
      solBalance,
      tokenAccounts,
      recentTransactions,
      explorerUrl: explorerAddressUrl(this.cluster, address),
    };
  }

  private async section<T>(
    cacheKey: string,
    source: string,
    load: () => Promise<Sourced<T>>,
  ): Promise<Sourced<T>> {
    const cached = await this.cache.get<T>(cacheKey);
    if (cached) return fromCache(cached);

    try {
      const value = await load();
      if (value.status !== "UNAVAILABLE") {
        await Promise.all([
          this.cache.set(cacheKey, value, OVERVIEW_CACHE_TTL_MS),
          this.cache.setLastSuccess(cacheKey, value.provenance.retrievedAt),
        ]);
      }
      return value;
    } catch (error) {
      if (!isProviderError(error)) throw error;
      return unavailableFromProviderError(error, {
        source,
        sourceType: "rpc",
        lastSuccessfulRetrievalAt: await this.cache.getLastSuccess(cacheKey),
      });
    }
  }
}
