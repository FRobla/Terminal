import { explorerTransactionUrl, type Cluster } from "@sct/network";
import {
  formatRawAmount,
  LAMPORTS_DECIMALS,
  type SignatureSummary,
  type SolBalance,
  type TokenAccountHolding,
} from "@sct/solana";
import type { RecentTransaction, TokenAccount, WalletOverview } from "@sct/validation";
import { sanitizeUntrustedText } from "./untrusted-text";

/** Pure mappings from on-chain readings to the Wallet Overview read model (SPEC-002 §3). */

export type LamportsValue = WalletOverview["solBalance"] extends infer S
  ? S extends { status: "AVAILABLE"; value: infer V }
    ? V
    : never
  : never;

export function toLamportsValue(balance: SolBalance): LamportsValue {
  return {
    lamports: balance.lamports.toString(),
    decimals: LAMPORTS_DECIMALS,
    uiAmount: formatRawAmount(balance.lamports, LAMPORTS_DECIMALS),
  };
}

export function toTokenAccount(holding: TokenAccountHolding): TokenAccount {
  return {
    tokenAccount: holding.tokenAccount,
    mint: holding.mint,
    programId: holding.programId,
    tokenProgram: holding.tokenProgram,
    amount: holding.amount.toString(),
    decimals: holding.decimals,
    uiAmount: formatRawAmount(holding.amount, holding.decimals),
    state: holding.state,
    isNative: holding.isNative,
  };
}

/**
 * Deterministic order: token program, then mint, then account. Amounts of different
 * mints are not comparable without prices, so they are not used for ordering.
 */
export function sortTokenAccounts(accounts: TokenAccount[]): TokenAccount[] {
  return [...accounts].sort(
    (a, b) =>
      a.tokenProgram.localeCompare(b.tokenProgram) ||
      a.mint.localeCompare(b.mint) ||
      a.tokenAccount.localeCompare(b.tokenAccount),
  );
}

export function toRecentTransaction(summary: SignatureSummary, cluster: Cluster): RecentTransaction {
  return {
    signature: summary.signature,
    slot: summary.slot.toString(),
    blockTime: summary.blockTime === null ? null : new Date(Number(summary.blockTime) * 1000).toISOString(),
    status: summary.failed ? "failed" : "succeeded",
    confirmationStatus: summary.confirmationStatus,
    memo: summary.memo === null ? null : sanitizeUntrustedText(summary.memo),
    explorerUrl: explorerTransactionUrl(cluster, summary.signature),
  };
}
