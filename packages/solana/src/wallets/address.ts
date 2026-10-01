import { isAddress, type Address } from "@solana/kit";

/** Returns a typed address when the value is a base58 string decoding to 32 bytes, otherwise null. */
export function parseAddress(value: string): Address | null {
  return isAddress(value) ? value : null;
}
