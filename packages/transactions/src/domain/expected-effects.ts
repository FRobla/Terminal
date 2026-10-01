import type { BalanceMovement } from "@sct/validation";

/** SOL balance change per account, in lamports (SPEC-004 §3 `expectedEffects`). */
export type SolEffects = ReadonlyMap<string, bigint>;

/** Expected effects of System transfers plus the fee charged to the fee payer. */
export function solTransferEffects(
  transfers: readonly { source: string; destination: string; lamports: bigint }[],
  feePayer: string,
  feeLamports: bigint,
): SolEffects {
  const effects = new Map<string, bigint>();
  const add = (account: string, delta: bigint) => effects.set(account, (effects.get(account) ?? 0n) + delta);
  for (const transfer of transfers) {
    add(transfer.source, -transfer.lamports);
    add(transfer.destination, transfer.lamports);
  }
  add(feePayer, -feeLamports);
  return effects;
}

/** TXL-AC-07 — every account with an expected change must show exactly that change. */
export function effectsMatch(expected: SolEffects, observed: SolEffects): boolean {
  for (const [account, delta] of expected) {
    if ((observed.get(account) ?? 0n) !== delta) return false;
  }
  return true;
}

export function toMovements(effects: SolEffects): BalanceMovement[] {
  return [...effects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([account, delta]) => ({ account, asset: "SOL" as const, deltaLamports: delta.toString() }));
}

export function fromMovements(movements: readonly BalanceMovement[]): SolEffects {
  return new Map(movements.map((movement) => [movement.account, BigInt(movement.deltaLamports)]));
}

/** Observed changes from per-account balances before and after (same order as `accounts`). */
export function observedEffects(
  accounts: readonly string[],
  before: readonly (bigint | null)[],
  after: readonly (bigint | null)[],
): SolEffects {
  return new Map(accounts.map((account, index) => [account, (after[index] ?? 0n) - (before[index] ?? 0n)]));
}
