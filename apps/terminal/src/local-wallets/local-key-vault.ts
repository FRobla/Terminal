import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSignableMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  type KeyPairSigner,
} from "@solana/kit";
import { decryptSeed, encryptSeed } from "./key-encryption";
import { SEED_BYTES, type LocalKeyRecord } from "./local-key-record";

/**
 * SPEC-010 §4 — generation, signing, and export of local keys. Plaintext seeds exist
 * only inside these functions and are overwritten before they return.
 */

/** LWG-AC-10 — Web Crypto Ed25519 is required to import and use the key. */
export async function isEd25519Supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

/** LWG-AC-01 — a random 32-byte Ed25519 seed from the browser CSPRNG, encrypted under the passphrase. */
export async function generateLocalKey(passphrase: string, cluster: string): Promise<LocalKeyRecord> {
  const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  try {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, false);
    const encrypted = await encryptSeed(seed, passphrase, signer.address);
    return {
      version: 1,
      address: signer.address,
      cluster,
      ...encrypted,
      createdAt: new Date().toISOString(),
    };
  } finally {
    seed.fill(0);
  }
}

/**
 * LWG-AC-05 — decrypts, builds a non-extractable signer for one operation, and drops it.
 * The signer must not escape `operation`.
 */
export async function withLocalSigner<T>(
  record: LocalKeyRecord,
  passphrase: string,
  operation: (signer: KeyPairSigner) => Promise<T>,
): Promise<T> {
  const seed = await decryptSeed(record, passphrase);
  let signer: KeyPairSigner;
  try {
    signer = await createKeyPairSignerFromPrivateKeyBytes(seed, false);
  } finally {
    seed.fill(0);
  }
  if (signer.address !== record.address) throw new Error("The decrypted key does not match this wallet.");
  return operation(signer);
}

/** Signs a text challenge (wallet registry ownership proof). */
export async function signMessageWith(signer: KeyPairSigner, message: Uint8Array): Promise<Uint8Array> {
  const [signatures] = await signer.signMessages([createSignableMessage(message)]);
  const signature = signatures?.[signer.address];
  if (!signature) throw new Error("The local key did not produce a signature.");
  return new Uint8Array(signature);
}

/** Adds this signer's signature to a wire transaction and returns the re-encoded bytes. */
export async function signWireTransactionWith(signer: KeyPairSigner, wire: Uint8Array): Promise<Uint8Array> {
  const transaction = getTransactionDecoder().decode(wire);
  if (!(signer.address in transaction.signatures)) {
    throw new Error("This wallet is not a required signer of the transaction.");
  }
  // An Ed25519 signature over the exact message bytes the API reviewed (SPEC-004 rule 5).
  const signature = await signBytes(signer.keyPair.privateKey, transaction.messageBytes);
  return new Uint8Array(
    getTransactionEncoder().encode({
      ...transaction,
      signatures: { ...transaction.signatures, [signer.address]: signature },
    }),
  );
}

/**
 * LWG-AC-07 — the Solana CLI keypair format: a JSON array of the 64-byte secret key
 * (seed followed by public key). The returned text is the recovery material itself.
 */
export async function recoveryFileContent(record: LocalKeyRecord, passphrase: string): Promise<string> {
  const seed = await decryptSeed(record, passphrase);
  try {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, false);
    if (signer.address !== record.address) throw new Error("The decrypted key does not match this wallet.");
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", signer.keyPair.publicKey));
    const secret = new Uint8Array(64);
    secret.set(seed, 0);
    secret.set(publicKey, 32);
    const text = JSON.stringify(Array.from(secret));
    secret.fill(0);
    return text;
  } finally {
    seed.fill(0);
  }
}
