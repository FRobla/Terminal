import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  signBytes,
  verifySignature,
  type Address,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildSolTransferTransaction, SYSTEM_PROGRAM_ADDRESS } from "./sol-transfer-transaction";
import {
  decodeMessage,
  decodeSystemTransfer,
  decodeWireTransaction,
  encodeWireTransaction,
} from "./transaction-decoding";

const BLOCKHASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

async function signer(seed: number) {
  return createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed));
}

describe("SOL transfer transaction (SPEC-004 amendment)", () => {
  it("TXL-AC-03: the built message decodes to one System transfer with the source as fee payer and only signer", async () => {
    const source = await signer(1);
    const destination = (await signer(2)).address;
    const built = buildSolTransferTransaction({
      source: source.address,
      destination,
      lamports: 1_234_567n,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 500n,
    });
    const decoded = decodeMessage(built.messageBytes);
    expect(decoded).toMatchObject({
      version: 0,
      feePayer: source.address,
      signers: [source.address],
      recentBlockhash: BLOCKHASH,
      usesAddressLookupTables: false,
    });
    expect(decoded.accounts).toEqual([
      { address: source.address, signer: true, writable: true },
      { address: destination, signer: false, writable: true },
      { address: SYSTEM_PROGRAM_ADDRESS, signer: false, writable: false },
    ]);
    expect(decoded.instructions).toHaveLength(1);
    expect(decodeSystemTransfer(decoded.instructions[0]!)).toEqual({
      source: source.address,
      destination,
      lamports: 1_234_567n,
    });

    const wire = decodeWireTransaction(built.wireBytes);
    expect(wire.messageBytes).toEqual(built.messageBytes);
    expect(wire.signatures).toEqual({ [source.address]: null });
  });

  it("TXL-AC-12: a signature over the message verifies and survives re-encoding", async () => {
    const source = await signer(3);
    const built = buildSolTransferTransaction({
      source: source.address,
      destination: (await signer(4)).address as Address,
      lamports: 1n,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 1n,
    });
    const signature = await signBytes(source.keyPair.privateKey, built.messageBytes);
    const signed = encodeWireTransaction({
      messageBytes: built.messageBytes,
      signatures: { [source.address]: new Uint8Array(signature) },
    });
    const decoded = decodeWireTransaction(signed);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(getAddressEncoder().encode(source.address)),
      "Ed25519",
      true,
      ["verify"],
    );
    expect(
      await verifySignature(publicKey, decoded.signatures[source.address] as never, decoded.messageBytes),
    ).toBe(true);
  });

  it("rejects non-positive amounts", async () => {
    const source = await signer(5);
    expect(() =>
      buildSolTransferTransaction({
        source: source.address,
        destination: source.address,
        lamports: 0n,
        blockhash: BLOCKHASH,
        lastValidBlockHeight: 1n,
      }),
    ).toThrow(RangeError);
  });
});
