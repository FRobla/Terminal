import type { CustodyType, WalletCategory, WalletRole } from "@sct/validation";

/** SPEC-009 §3 — registry invariants that the request schemas alone cannot express. */

/** Active wallets an organization may hold (SPEC-009 §6). */
export const MAX_ACTIVE_WALLETS_PER_ORGANIZATION = 500;

/** Signatures indexed per wallet before the backfill stops (SPEC-009 §4.8). */
export const WALLET_BACKFILL_CAP = 1000;

/** Invariant 3: the `WATCH_ONLY` category is reserved for watch-only custody. */
export function isCategoryAllowed(category: WalletCategory, custodyType: CustodyType): boolean {
  return category !== "WATCH_ONLY" || custodyType === "WATCH_ONLY";
}

/** Roles that may initiate transactions from a wallet (SPEC-004 amendment, TXL-AC-10). */
export const CONTROLLING_ROLES: readonly WalletRole[] = ["CREATOR", "CONTROLLER"];

export function canInitiateTransactions(roles: readonly WalletRole[]): boolean {
  return roles.some((role) => CONTROLLING_ROLES.includes(role));
}
