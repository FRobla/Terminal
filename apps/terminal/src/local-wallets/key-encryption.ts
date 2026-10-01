import { IV_BYTES, PBKDF2_ITERATIONS, SALT_BYTES, type LocalKeyRecord } from "./local-key-record";

/** SPEC-010 §3 — PBKDF2-SHA-256 → AES-256-GCM encryption of the Ed25519 seed (Web Crypto only). */

export class WrongPassphraseError extends Error {
  constructor() {
    super("The passphrase is incorrect.");
    this.name = "WrongPassphraseError";
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSeed(
  seed: Uint8Array,
  passphrase: string,
  address: string,
): Promise<Pick<LocalKeyRecord, "kdf" | "cipher" | "ciphertext">> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(address) },
      key,
      seed as BufferSource,
    ),
  );
  return {
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt },
    cipher: { name: "AES-GCM", iv },
    ciphertext,
  };
}

/** LWG-AC-03 — the caller must overwrite the returned seed when done. */
export async function decryptSeed(record: LocalKeyRecord, passphrase: string): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, record.kdf.salt, record.kdf.iterations);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: record.cipher.iv as BufferSource,
          additionalData: new TextEncoder().encode(record.address),
        },
        key,
        record.ciphertext as BufferSource,
      ),
    );
  } catch {
    // AES-GCM authentication failure: a wrong passphrase (or a tampered record). No detail is given.
    throw new WrongPassphraseError();
  }
}
