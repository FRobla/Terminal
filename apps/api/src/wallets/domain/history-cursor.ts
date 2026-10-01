/**
 * Opaque keyset cursor for indexed history (newest first by slot, then id).
 * Malformed cursors decode to null and the listing restarts from the newest row.
 */
export function encodeHistoryCursor(position: { slot: bigint; id: string }): string {
  return Buffer.from(`${position.slot.toString()}:${position.id}`, "utf8").toString("base64url");
}

const CURSOR_PATTERN = /^(0|[1-9]\d{0,19}):([0-9a-f-]{36})$/;

export function decodeHistoryCursor(cursor: string): { slot: bigint; id: string } | null {
  const match = CURSOR_PATTERN.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match?.[1] || !match[2]) return null;
  return { slot: BigInt(match[1]), id: match[2] };
}
