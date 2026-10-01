import { z } from "zod";

/** SPEC-010 §3 — the encrypted key record kept in IndexedDB. It never contains plaintext key material. */

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const SEED_BYTES = 32;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 256;

const bytesSchema = (length: number) =>
  z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.length === length, { message: `Expected ${length} bytes` });

export const localKeyRecordSchema = z.object({
  version: z.literal(1),
  address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  cluster: z.string(),
  kdf: z.object({
    name: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    iterations: z.number().int().min(PBKDF2_ITERATIONS),
    salt: bytesSchema(SALT_BYTES),
  }),
  cipher: z.object({ name: z.literal("AES-GCM"), iv: bytesSchema(IV_BYTES) }),
  /** AES-256-GCM of the 32-byte seed with the address as additional authenticated data (seed + 16-byte tag). */
  ciphertext: bytesSchema(SEED_BYTES + 16),
  createdAt: z.iso.datetime(),
});

export type LocalKeyRecord = z.infer<typeof localKeyRecordSchema>;

/** LWG-AC-04 — returns a message when the passphrase pair is not acceptable. */
export function passphraseProblem(passphrase: string, confirmation: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) return `Use at most ${MAX_PASSPHRASE_LENGTH} characters.`;
  if (passphrase !== confirmation) return "The passphrases do not match.";
  return null;
}
