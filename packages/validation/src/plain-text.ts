import { z } from "zod";

/**
 * Control, format (including bidirectional overrides and zero-width characters),
 * and line/paragraph separators. User-supplied labels must not contain them.
 */
const DISALLOWED_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function isPlainSingleLineText(value: string): boolean {
  return !DISALLOWED_CHARACTERS.test(value);
}

/** Trimmed, single-line, user-supplied text rendered as plain text (names, labels, messages). */
export function plainTextSchema(options: { max: number }) {
  return z
    .string()
    .trim()
    .min(1, "Must not be empty")
    .max(options.max, `Must be at most ${options.max} characters`)
    .refine(isPlainSingleLineText, "Must not contain control or formatting characters");
}
