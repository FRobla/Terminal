/**
 * Programs the review can name (SPEC-004 rule 4). Anything else is shown as
 * `UNKNOWN PROGRAM` and needs explicit acknowledgement before signing.
 */
export const KNOWN_PROGRAMS: Readonly<Record<string, string>> = {
  "11111111111111111111111111111111": "System Program",
  ComputeBudget111111111111111111111111111111: "Compute Budget Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token Program",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022 Program",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account Program",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo Program",
};

export function knownProgramName(programId: string): string | null {
  return KNOWN_PROGRAMS[programId] ?? null;
}
