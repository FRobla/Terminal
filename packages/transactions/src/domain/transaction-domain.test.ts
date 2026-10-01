import { describe, expect, it } from "vitest";
import { effectsMatch, observedEffects, solTransferEffects, toMovements } from "./expected-effects";
import { buildReview, describeChainError } from "./transaction-review";
import {
  assertTransition,
  IllegalTransitionError,
  isTerminalState,
  TRANSACTION_STATES,
  TransactionClusterMismatchError,
  TRANSITIONS,
  type TransactionState,
} from "./transaction-state";

/** The allowed transitions, written out independently of the implementation table. */
const EXPECTED: Record<TransactionState, TransactionState[]> = {
  DRAFT: ["SIMULATING"],
  SIMULATING: ["SIMULATED", "SIMULATION_FAILED"],
  SIMULATED: ["AWAITING_SIGNATURE", "SIMULATION_FAILED"],
  SIMULATION_FAILED: [],
  AWAITING_SIGNATURE: ["SIGNING", "CANCELLED", "EXPIRED"],
  CANCELLED: [],
  SIGNING: ["SUBMITTED", "SIGNING_FAILED", "EXPIRED"],
  SIGNING_FAILED: [],
  SUBMITTED: ["CONFIRMING", "SUBMISSION_FAILED"],
  SUBMISSION_FAILED: [],
  CONFIRMING: ["CONFIRMED", "CONFIRMATION_FAILED", "EXPIRED"],
  EXPIRED: [],
  CONFIRMATION_FAILED: [],
  CONFIRMED: ["RECONCILED", "RECONCILIATION_REQUIRED", "RECONCILIATION_FAILED"],
  RECONCILED: [],
  RECONCILIATION_REQUIRED: ["RECONCILED", "RECONCILIATION_FAILED"],
  RECONCILIATION_FAILED: [],
};

describe("Transaction state machine (SPEC-004 §2)", () => {
  it("TXL-AC-01: every pair of states is allowed exactly when the table says so", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...TRANSACTION_STATES].sort());
    for (const from of TRANSACTION_STATES) {
      for (const to of TRANSACTION_STATES) {
        const allowed = EXPECTED[from].includes(to);
        const attempt = () => assertTransition({ state: from, cluster: "devnet" }, to, "devnet");
        if (allowed) expect(attempt, `${from} → ${to}`).not.toThrow();
        else expect(attempt, `${from} → ${to}`).toThrow(IllegalTransitionError);
      }
    }
  });

  it("TXL-AC-02: nothing reaches AWAITING_SIGNATURE except from SIMULATED", () => {
    const sources = TRANSACTION_STATES.filter((state) => TRANSITIONS[state].includes("AWAITING_SIGNATURE"));
    expect(sources).toEqual(["SIMULATED"]);
  });

  it("TXL-AC-05/06: expiry and on-chain failure are distinct terminal states", () => {
    expect(isTerminalState("EXPIRED")).toBe(true);
    expect(isTerminalState("CONFIRMATION_FAILED")).toBe(true);
    expect(TRANSITIONS.CONFIRMING).toEqual(expect.arrayContaining(["EXPIRED", "CONFIRMATION_FAILED"]));
    expect(TRANSITIONS.SUBMITTED).not.toContain("EXPIRED");
  });

  it("TXL-AC-08: a record on another cluster cannot transition", () => {
    expect(() => assertTransition({ state: "DRAFT", cluster: "testnet" }, "SIMULATING", "devnet")).toThrow(
      TransactionClusterMismatchError,
    );
  });
});

describe("Expected effects (SPEC-004 rule 8)", () => {
  it("TXL-AC-07: a SOL transfer debits amount plus fee and credits the amount", () => {
    const effects = solTransferEffects([{ source: "A", destination: "B", lamports: 1_000n }], "A", 5_000n);
    expect(toMovements(effects)).toEqual([
      { account: "A", asset: "SOL", deltaLamports: "-6000" },
      { account: "B", asset: "SOL", deltaLamports: "1000" },
    ]);
    expect(effectsMatch(effects, observedEffects(["A", "B"], [10_000n, null], [4_000n, 1_000n]))).toBe(true);
    expect(effectsMatch(effects, observedEffects(["A", "B"], [10_000n, 0n], [4_000n, 999n]))).toBe(false);
  });
});

describe("Review (SPEC-004 rule 3/4)", () => {
  const decoded = {
    feePayer: "A",
    signers: ["A"],
    accounts: [
      { address: "A", signer: true, writable: true },
      { address: "B", signer: false, writable: true },
      { address: "11111111111111111111111111111111", signer: false, writable: false },
    ],
    instructions: [{ programId: "11111111111111111111111111111111" }],
    recentBlockhash: "hash",
    usesAddressLookupTables: false,
  };

  it("TXL-AC-03: names known programs and requires acknowledgement for unknown ones", () => {
    const review = buildReview({
      cluster: "devnet",
      decoded,
      movements: [],
      feeLamports: 5_000n,
      simulation: { error: null, logs: ["Program log: ok\u202E"], unitsConsumed: 150n },
      lastValidBlockHeight: 99n,
    });
    expect(review).toMatchObject({
      programs: [{ programId: "11111111111111111111111111111111", name: "System Program", known: true }],
      feeLamports: "5000",
      simulation: { status: "SUCCEEDED", unitsConsumed: "150", logs: ["Program log: ok"] },
      requiresUnknownProgramAcknowledgement: false,
      lastValidBlockHeight: "99",
    });
    const unknown = buildReview({
      cluster: "devnet",
      decoded: { ...decoded, instructions: [{ programId: "Unknown1111111111111111111111111111111111" }] },
      movements: [],
      feeLamports: null,
      simulation: { error: { InstructionError: [0, { Custom: 1n }] }, logs: [], unitsConsumed: null },
      lastValidBlockHeight: 1n,
    });
    expect(unknown.requiresUnknownProgramAcknowledgement).toBe(true);
    expect(unknown.programs[0]).toMatchObject({ name: null, known: false });
    expect(unknown.simulation).toMatchObject({
      status: "FAILED",
      error: '{"InstructionError":[0,{"Custom":"1"}]}',
    });
  });

  it("TXL-AC-06: chain errors render as one bounded line", () => {
    expect(describeChainError(null)).toBeNull();
    expect(describeChainError("x".repeat(600))?.length).toBe(501);
  });
});
