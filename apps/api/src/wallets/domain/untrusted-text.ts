/**
 * Neutralizes untrusted on-chain text (memos, metadata) for display (WO-AC-17,
 * SECURITY.md §11): removes C0/C1 control characters, bidirectional overrides and
 * isolates, zero-width characters, and the byte-order mark. Line breaks and tabs
 * become spaces. The UI still renders the result as plain text only.
 */
const UNSAFE_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function sanitizeUntrustedText(value: string): string {
  return value
    .replace(/[\t\n\r]+/g, " ")
    .replace(UNSAFE_CHARACTERS, "")
    .trim();
}
