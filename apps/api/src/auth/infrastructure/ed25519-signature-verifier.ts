import { address, getPublicKeyFromAddress, signatureBytes, verifySignature } from "@solana/kit";
import type { SignatureVerifier } from "../application/ports";

/** Verifies Ed25519 signatures with Web Crypto through `@solana/kit`. */
export class Ed25519SignatureVerifier implements SignatureVerifier {
  async verify(walletAddress: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (signature.length !== 64) return false;
    try {
      const publicKey = await getPublicKeyFromAddress(address(walletAddress));
      return await verifySignature(publicKey, signatureBytes(signature), message);
    } catch {
      return false;
    }
  }
}
