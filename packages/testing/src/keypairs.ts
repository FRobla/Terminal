import { generateKeyPair, getAddressFromPublicKey, signBytes, type Address } from "@solana/kit";

/** Per-run test identity. Keys are generated in memory and never persisted or reused. */
export interface TestKeyPair {
  address: Address;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

export async function createTestKeyPair(): Promise<TestKeyPair> {
  const keyPair = await generateKeyPair();
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  return {
    address,
    sign: async (message) => new Uint8Array(await signBytes(keyPair.privateKey, message)),
  };
}
