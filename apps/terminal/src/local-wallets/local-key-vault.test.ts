import { createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, verifySignature } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { decryptSeed, WrongPassphraseError } from "./key-encryption";
import { localKeyRecordSchema, passphraseProblem, PBKDF2_ITERATIONS } from "./local-key-record";
import {
  generateLocalKey,
  isEd25519Supported,
  recoveryFileContent,
  signMessageWith,
  withLocalSigner,
} from "./local-key-vault";

const PASSPHRASE = "correct horse battery staple";

describe("Local key vault (SPEC-010)", () => {
  it("LWG-AC-10: Ed25519 is detected in Web Crypto", async () => {
    expect(await isEd25519Supported()).toBe(true);
  });

  it("LWG-AC-01: generates a version-1 record with PBKDF2 and AES-GCM parameters and no plaintext seed", async () => {
    const record = await generateLocalKey(PASSPHRASE, "devnet");
    expect(localKeyRecordSchema.parse(record)).toEqual(record);
    expect(record.kdf).toMatchObject({ name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS });
    expect(record.kdf.salt).toHaveLength(16);
    expect(record.cipher.iv).toHaveLength(12);
    expect(record.ciphertext).toHaveLength(48);

    const seed = await decryptSeed(record, PASSPHRASE);
    const serialized = JSON.stringify({
      ...record,
      kdf: { ...record.kdf, salt: Array.from(record.kdf.salt) },
      cipher: { ...record.cipher, iv: Array.from(record.cipher.iv) },
      ciphertext: Array.from(record.ciphertext),
    });
    expect(serialized).not.toContain(JSON.stringify(Array.from(seed)).slice(1, -1));
    seed.fill(0);
  });

  it("LWG-AC-03: decrypts to the record's address; a wrong passphrase yields no key", async () => {
    const record = await generateLocalKey(PASSPHRASE, "devnet");
    const seed = await decryptSeed(record, PASSPHRASE);
    expect((await createKeyPairSignerFromPrivateKeyBytes(seed)).address).toBe(record.address);
    seed.fill(0);

    await expect(decryptSeed(record, "not the passphrase")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(decryptSeed(record, "not the passphrase")).rejects.toThrow("The passphrase is incorrect.");
    // The address is authenticated data: moving the ciphertext to another address fails.
    await expect(
      decryptSeed({ ...record, address: "11111111111111111111111111111111" }, PASSPHRASE),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("LWG-AC-04: passphrase policy", () => {
    expect(passphraseProblem("short", "short")).toBe("Use at least 12 characters.");
    expect(passphraseProblem("x".repeat(257), "x".repeat(257))).toBe("Use at most 256 characters.");
    expect(passphraseProblem(PASSPHRASE, `${PASSPHRASE}!`)).toBe("The passphrases do not match.");
    expect(passphraseProblem(PASSPHRASE, PASSPHRASE)).toBeNull();
  });

  it("LWG-AC-05: signs with a non-extractable key whose signature verifies against the address", async () => {
    const record = await generateLocalKey(PASSPHRASE, "devnet");
    const message = new TextEncoder().encode("prove control");
    const signature = await withLocalSigner(record, PASSPHRASE, async (signer) => {
      expect(signer.keyPair.privateKey.extractable).toBe(false);
      return signMessageWith(signer, message);
    });
    const publicKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(getAddressEncoder().encode(record.address as never)),
      "Ed25519",
      true,
      ["verify"],
    );
    expect(await verifySignature(publicKey, signature as never, message)).toBe(true);
  });

  it("LWG-AC-07: the recovery file is a 64-byte Solana CLI key whose public half is the address", async () => {
    const record = await generateLocalKey(PASSPHRASE, "devnet");
    const bytes = JSON.parse(await recoveryFileContent(record, PASSPHRASE)) as number[];
    expect(bytes).toHaveLength(64);
    expect(bytes.slice(32)).toEqual(Array.from(getAddressEncoder().encode(record.address as never)));
    await expect(recoveryFileContent(record, "wrong passphrase!")).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });
});
