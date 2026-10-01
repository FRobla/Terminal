import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "./sol-transfer-transaction";

/** What a compiled message says, decoded from its bytes (SPEC-004 rule 3: the review comes from here). */
export interface DecodedMessage {
  version: "legacy" | 0;
  feePayer: string;
  signers: string[];
  accounts: { address: string; signer: boolean; writable: boolean }[];
  instructions: { programId: string; accounts: string[]; data: Uint8Array }[];
  recentBlockhash: string;
  /** Accounts loaded from lookup tables cannot be listed without resolving the tables. */
  usesAddressLookupTables: boolean;
}

export function decodeMessage(messageBytes: Uint8Array): DecodedMessage {
  const compiled = getCompiledTransactionMessageDecoder().decode(messageBytes);
  if (compiled.version === 1) throw new Error("Version 1 transaction messages are not supported");
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = compiled.header;
  const keys = compiled.staticAccounts.map(String);
  const accounts = keys.map((address, index) => {
    const signer = index < numSignerAccounts;
    const writable = signer
      ? index < numSignerAccounts - numReadonlySignerAccounts
      : index < keys.length - numReadonlyNonSignerAccounts;
    return { address, signer, writable };
  });
  const lookups = "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
  return {
    version: compiled.version,
    feePayer: keys[0] ?? "",
    signers: keys.slice(0, numSignerAccounts),
    accounts,
    instructions: compiled.instructions.map((instruction) => ({
      programId: keys[instruction.programAddressIndex] ?? "UNRESOLVED",
      accounts: (instruction.accountIndices ?? []).map((index) => keys[index] ?? "UNRESOLVED"),
      data: new Uint8Array(instruction.data ?? new Uint8Array()),
    })),
    recentBlockhash: String(compiled.lifetimeToken),
    usesAddressLookupTables: lookups.length > 0,
  };
}

/** A System `Transfer` decoded from an instruction, or null when the instruction is anything else. */
export function decodeSystemTransfer(
  instruction: DecodedMessage["instructions"][number],
): { source: string; destination: string; lamports: bigint } | null {
  if (instruction.programId !== SYSTEM_PROGRAM_ADDRESS || instruction.data.length !== 12) return null;
  const view = new DataView(
    instruction.data.buffer,
    instruction.data.byteOffset,
    instruction.data.byteLength,
  );
  if (view.getUint32(0, true) !== 2) return null;
  const [source, destination] = instruction.accounts;
  if (!source || !destination) return null;
  return { source, destination, lamports: view.getBigUint64(4, true) };
}

export interface DecodedWireTransaction {
  messageBytes: Uint8Array;
  /** Signature per required signer address; null when that slot is empty (all zeros). */
  signatures: Record<string, Uint8Array | null>;
}

export function decodeWireTransaction(wire: Uint8Array): DecodedWireTransaction {
  const transaction = getTransactionDecoder().decode(wire);
  const signatures: Record<string, Uint8Array | null> = {};
  for (const [address, signature] of Object.entries(transaction.signatures) as [
    string,
    ReadonlyUint8Array | null,
  ][]) {
    signatures[address] =
      signature && signature.some((byte) => byte !== 0) ? new Uint8Array(signature) : null;
  }
  return { messageBytes: new Uint8Array(transaction.messageBytes), signatures };
}

/** Re-encodes a decoded transaction (used to normalize what is stored and sent). */
export function encodeWireTransaction(decoded: DecodedWireTransaction): Uint8Array {
  return new Uint8Array(
    getTransactionEncoder().encode({
      messageBytes: decoded.messageBytes as never,
      signatures: decoded.signatures as never,
    }),
  );
}
