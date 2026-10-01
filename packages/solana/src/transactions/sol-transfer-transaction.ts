import {
  AccountRole,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111" as Address;

/** System Program instruction index of `Transfer`. */
const SYSTEM_TRANSFER_INSTRUCTION = 2;

/** System Program `Transfer { lamports: u64 }`: source (writable signer) → destination (writable). */
export function systemTransferInstruction(
  source: Address,
  destination: Address,
  lamports: bigint,
): Instruction {
  if (lamports <= 0n || lamports >= 2n ** 64n) throw new RangeError("Transfer amount must be a positive u64");
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, SYSTEM_TRANSFER_INSTRUCTION, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: source, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export interface UnsignedTransaction {
  /** The compiled message: what the signer signs and what the review describes. */
  messageBytes: Uint8Array;
  /** The wire transaction with an empty (zeroed) signature slot for each signer. */
  wireBytes: Uint8Array;
}

/**
 * SPEC-004 amendment — a version-0 transaction with one System `Transfer`, the source as
 * fee payer and only signer, and a recent blockhash lifetime. No compute-budget instructions.
 */
export function buildSolTransferTransaction(options: {
  source: Address;
  destination: Address;
  lamports: bigint;
  blockhash: string;
  lastValidBlockHeight: bigint;
}): UnsignedTransaction {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(options.source, draft),
    (draft) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: options.blockhash as Blockhash, lastValidBlockHeight: options.lastValidBlockHeight },
        draft,
      ),
    (draft) =>
      appendTransactionMessageInstruction(
        systemTransferInstruction(options.source, options.destination, options.lamports),
        draft,
      ),
  );
  const transaction = compileTransaction(message);
  return {
    messageBytes: new Uint8Array(transaction.messageBytes),
    wireBytes: new Uint8Array(getTransactionEncoder().encode(transaction)),
  };
}
