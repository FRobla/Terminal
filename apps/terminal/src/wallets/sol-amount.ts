const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Exact SOL display of an integer lamport string (no floating point), signed when negative. */
export function formatSol(lamports: string): string {
  const value = BigInt(lamports);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / LAMPORTS_PER_SOL).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Parses a decimal SOL amount typed by the user into lamports; null when invalid or over 9 decimals. */
export function parseSolToLamports(input: string): bigint | null {
  const match = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(input.trim());
  if (!match?.[1]) return null;
  return BigInt(match[1]) * LAMPORTS_PER_SOL + BigInt((match[2] ?? "").padEnd(9, "0"));
}
