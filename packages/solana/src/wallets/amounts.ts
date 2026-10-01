export const LAMPORTS_DECIMALS = 9;

/**
 * Converts a raw integer amount to an exact decimal string using integer
 * arithmetic only (no floating point). Trailing fractional zeros are removed.
 */
export function formatRawAmount(raw: bigint, decimals: number): string {
  if (raw < 0n) throw new RangeError("Amounts must be non-negative");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new RangeError("Invalid decimals");
  if (decimals === 0) return raw.toString();
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}
