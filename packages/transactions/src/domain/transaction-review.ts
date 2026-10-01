import type { Cluster } from "@sct/network";
import type { BalanceMovement, TransactionReview } from "@sct/validation";
import { knownProgramName } from "./known-programs";

const MAX_LOG_LINES = 50;
const MAX_LOG_LINE_LENGTH = 300;
const MAX_ERROR_LENGTH = 500;
const UNSAFE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Untrusted RPC text (logs, errors) as inert, bounded plain text. */
function inert(text: string, max: number): string {
  const clean = text
    .replace(/[\t\n\r]+/g, " ")
    .replace(UNSAFE, "")
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** On-chain error structures contain bigints and nested objects; this renders them as one bounded line. */
export function describeChainError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const text =
    typeof error === "string"
      ? error
      : JSON.stringify(error, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        );
  return inert(text ?? String(error), MAX_ERROR_LENGTH);
}

export interface DecodedMessageView {
  feePayer: string;
  signers: string[];
  accounts: { address: string; signer: boolean; writable: boolean }[];
  instructions: { programId: string }[];
  recentBlockhash: string;
  usesAddressLookupTables: boolean;
}

/** TXL-AC-03 — the human-readable review, derived from the decoded message and the simulation. */
export function buildReview(input: {
  cluster: Cluster;
  decoded: DecodedMessageView;
  movements: BalanceMovement[];
  feeLamports: bigint | null;
  simulation: { error: unknown; logs: string[]; unitsConsumed: bigint | null };
  lastValidBlockHeight: bigint;
}): TransactionReview {
  const programIds = [...new Set(input.decoded.instructions.map((instruction) => instruction.programId))];
  const programs = programIds.map((programId) => {
    const name = knownProgramName(programId);
    return { programId, name, known: name !== null };
  });
  return {
    cluster: input.cluster,
    feePayer: input.decoded.feePayer,
    signers: input.decoded.signers,
    programs,
    accounts: input.decoded.accounts,
    movements: input.movements,
    feeLamports: input.feeLamports === null ? null : input.feeLamports.toString(),
    simulation: {
      status: input.simulation.error === null ? "SUCCEEDED" : "FAILED",
      unitsConsumed:
        input.simulation.unitsConsumed === null ? null : input.simulation.unitsConsumed.toString(),
      error: describeChainError(input.simulation.error),
      logs: input.simulation.logs.slice(0, MAX_LOG_LINES).map((line) => inert(line, MAX_LOG_LINE_LENGTH)),
    },
    requiresUnknownProgramAcknowledgement:
      programs.some((program) => !program.known) || input.decoded.usesAddressLookupTables,
    recentBlockhash: input.decoded.recentBlockhash,
    lastValidBlockHeight: input.lastValidBlockHeight.toString(),
  };
}
