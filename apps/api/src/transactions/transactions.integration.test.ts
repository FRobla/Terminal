import { buildSolTransferTransaction, decodeWireTransaction, encodeWireTransaction } from "@sct/solana";
import { createTestKeyPair, DEVNET_GENESIS_HASH, type StubRpcHandler, type TestKeyPair } from "@sct/testing";
import type { Address } from "@solana/kit";
import { afterEach, describe, expect, it } from "vitest";
import { callAs, createTestApi, migratorQuery, type TestApi, type TestSession } from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const SOURCE_BALANCE = 10_000_000_000;
const FEE = 5_000;
const LAMPORTS = "1500000";

function account(lamports: number) {
  return {
    lamports,
    owner: "11111111111111111111111111111111",
    data: ["", "base64"],
    executable: false,
    rentEpoch: 0,
    space: 0,
  };
}

/** A healthy chain: the simulation debits amount plus fee from the source and credits the destination. */
function chain(
  source: () => string,
  overrides: Record<string, StubRpcHandler> = {},
): Record<string, StubRpcHandler> {
  return {
    getLatestBlockhash: () => ({
      kind: "result",
      result: {
        context: { slot: 100 },
        value: { blockhash: DEVNET_GENESIS_HASH, lastValidBlockHeight: 1000 },
      },
    }),
    getFeeForMessage: () => ({ kind: "result", result: { context: { slot: 100 }, value: FEE } }),
    getMultipleAccounts: (params) => ({
      kind: "result",
      result: {
        context: { slot: 100 },
        value: (params[0] as string[]).map((address) =>
          address === source() ? account(SOURCE_BALANCE) : null,
        ),
      },
    }),
    simulateTransaction: () => ({
      kind: "result",
      result: {
        context: { slot: 101 },
        value: {
          err: null,
          logs: [
            "Program 11111111111111111111111111111111 invoke [1]",
            "Program 11111111111111111111111111111111 success",
          ],
          unitsConsumed: 150,
          accounts: [account(SOURCE_BALANCE - Number(LAMPORTS) - FEE), account(Number(LAMPORTS))],
        },
      },
    }),
    getBlockHeight: () => ({ kind: "result", result: 500 }),
    sendTransaction: () => ({ kind: "result", result: "5".repeat(88) }),
    ...overrides,
  };
}

interface Setup {
  session: TestSession;
  wallet: { id: string; address: string };
  key: TestKeyPair;
  destination: string;
}

async function setup(overrides: Record<string, StubRpcHandler> = {}, roleKey = "operator"): Promise<Setup> {
  const key = await createTestKeyPair();
  api = await createTestApi({ rpcHandlers: chain(() => key.address, overrides) });
  const session = await api.signIn();
  await api.grantRole(session.userId, roleKey === "viewer" ? "operator" : roleKey);
  const challenge = (
    await callAs(api, session, "POST", "/wallets/ownership-challenges", { address: key.address })
  ).json().data as { challengeId: string; message: string };
  const signature = Buffer.from(await key.sign(new TextEncoder().encode(challenge.message))).toString(
    "base64",
  );
  const wallet = (
    await callAs(api, session, "POST", "/wallets", {
      custodyType: "BROWSER_WALLET",
      address: key.address,
      label: "Hot wallet",
      category: "TREASURY",
      ownership: { challengeId: challenge.challengeId, signature },
    })
  ).json().data as { id: string; address: string };
  const destination = (await createTestKeyPair()).address;
  return { session, wallet, key, destination };
}

function prepare(
  s: Setup,
  overrides: Partial<{ lamports: string; idempotencyKey: string; destination: string }> = {},
) {
  return callAs(api!, s.session, "POST", "/transactions/sol-transfers", {
    sourceWalletId: s.wallet.id,
    destination: overrides.destination ?? s.destination,
    lamports: overrides.lamports ?? LAMPORTS,
    idempotencyKey: overrides.idempotencyKey ?? `key-${Math.random().toString(36).slice(2)}-0000000000`,
  });
}

async function sign(key: TestKeyPair, unsignedBase64: string): Promise<string> {
  const decoded = decodeWireTransaction(new Uint8Array(Buffer.from(unsignedBase64, "base64")));
  const signature = await key.sign(decoded.messageBytes);
  return Buffer.from(
    encodeWireTransaction({ ...decoded, signatures: { [key.address]: new Uint8Array(signature) } }),
  ).toString("base64");
}

describe("SOL transfer lifecycle (SPEC-004)", () => {
  it("TXL-AC-02/03/09/14: prepares, simulates, reviews, signs, and submits with every transition audited", async () => {
    const s = await setup();
    const prepared = await prepare(s);
    expect(prepared.statusCode).toBe(200);
    const record = prepared.json().data;
    expect(record).toMatchObject({
      state: "AWAITING_SIGNATURE",
      purpose: "sol-transfer",
      feePayer: s.key.address,
      intent: { destination: s.destination, lamports: LAMPORTS },
      walletLabel: "Hot wallet",
    });
    expect(record.review).toMatchObject({
      cluster: "devnet",
      feePayer: s.key.address,
      signers: [s.key.address],
      programs: [{ programId: "11111111111111111111111111111111", name: "System Program", known: true }],
      feeLamports: "5000",
      simulation: { status: "SUCCEEDED", unitsConsumed: "150" },
      requiresUnknownProgramAcknowledgement: false,
      lastValidBlockHeight: "1000",
    });
    expect(record.review.movements).toEqual(
      expect.arrayContaining([
        { account: s.key.address, asset: "SOL", deltaLamports: "-1505000" },
        { account: s.destination, asset: "SOL", deltaLamports: "1500000" },
      ]),
    );
    expect(record.stateHistory.map((change: { to: string }) => change.to)).toEqual([
      "DRAFT",
      "SIMULATING",
      "SIMULATED",
      "AWAITING_SIGNATURE",
    ]);
    expect(record.unsignedTransactionBase64).toEqual(expect.any(String));

    const signing = await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    expect(signing.json().data.state).toBe("SIGNING");

    const signed = await sign(s.key, record.unsignedTransactionBase64);
    const submitted = await callAs(api!, s.session, "POST", `/transactions/${record.id}/submit`, {
      signedTransactionBase64: signed,
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().data).toMatchObject({ state: "SUBMITTED", unsignedTransactionBase64: null });
    expect(submitted.json().data.signature).toEqual(expect.any(String));
    expect(api!.stub.calls.get("sendTransaction")).toBe(1);

    const audit = await migratorQuery<{
      action: string;
      request_id: string;
      metadata: Record<string, unknown>;
    }>(
      "SELECT action, request_id, metadata FROM audit_events WHERE resource_type = 'transaction' ORDER BY occurred_at",
    );
    expect(audit.map((row) => row.action)).toEqual([
      "transaction.prepared",
      "transaction.simulation_requested",
      "transaction.simulated",
      "transaction.review_ready",
      "transaction.signing_requested",
      "transaction.submitted",
    ]);
    expect(audit.every((row) => row.request_id && row.request_id !== "system")).toBe(true);
    expect(audit.at(-1)?.metadata).toMatchObject({
      from: "SIGNING",
      to: "SUBMITTED",
      txSignature: submitted.json().data.signature,
    });

    const detail = await callAs(api!, s.session, "GET", `/transactions/${record.id}`);
    expect(detail.json().data.state).toBe("SUBMITTED");
    const list = await callAs(api!, s.session, "GET", `/transactions?walletId=${s.wallet.id}`);
    expect(list.json().data.map((entry: { id: string }) => entry.id)).toEqual([record.id]);
  });

  it("TXL-AC-04/15: idempotency keys and repeated submissions send once", async () => {
    const s = await setup();
    const first = (await prepare(s, { idempotencyKey: "fixed-key-0000000001" })).json().data;
    const again = await prepare(s, { idempotencyKey: "fixed-key-0000000001" });
    expect(again.json().data.id).toBe(first.id);
    const conflicting = await prepare(s, { idempotencyKey: "fixed-key-0000000001", lamports: "7" });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().code).toBe("IDEMPOTENCY_CONFLICT");

    await callAs(api!, s.session, "POST", `/transactions/${first.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const signed = await sign(s.key, first.unsignedTransactionBase64);
    const [one, two] = await Promise.all([
      callAs(api!, s.session, "POST", `/transactions/${first.id}/submit`, {
        signedTransactionBase64: signed,
      }),
      callAs(api!, s.session, "POST", `/transactions/${first.id}/submit`, {
        signedTransactionBase64: signed,
      }),
    ]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    const three = await callAs(api!, s.session, "POST", `/transactions/${first.id}/submit`, {
      signedTransactionBase64: signed,
    });
    expect(three.json().data.state).toBe("SUBMITTED");
    expect(api!.stub.calls.get("sendTransaction")).toBe(1);
    const records = await migratorQuery("SELECT 1 FROM transaction_records");
    expect(records).toHaveLength(1);
  });

  it("TXL-AC-10: only controllers of a controlled, active source wallet can prepare transfers", async () => {
    const s = await setup();
    const viewer = await api!.signIn();
    await api!.grantRole(viewer.userId, "viewer");
    const denied = await callAs(api!, viewer, "POST", "/transactions/sol-transfers", {
      sourceWalletId: s.wallet.id,
      destination: s.destination,
      lamports: LAMPORTS,
      idempotencyKey: "viewer-key-000000001",
    });
    expect(denied.statusCode).toBe(403);

    const otherOperator = await api!.signIn();
    await api!.grantRole(otherOperator.userId, "operator");
    const unassigned = await callAs(api!, otherOperator, "POST", "/transactions/sol-transfers", {
      sourceWalletId: s.wallet.id,
      destination: s.destination,
      lamports: LAMPORTS,
      idempotencyKey: "other-key-0000000001",
    });
    expect(unassigned.statusCode).toBe(403);
    expect(unassigned.json().code).toBe("FORBIDDEN");

    const watched = (await createTestKeyPair()).address;
    const watchOnly = (
      await callAs(api!, s.session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;
    const refused = await callAs(api!, s.session, "POST", "/transactions/sol-transfers", {
      sourceWalletId: watchOnly.id,
      destination: s.destination,
      lamports: LAMPORTS,
      idempotencyKey: "watch-key-0000000001",
    });
    expect(refused.json().code).toBe("OPERATION_NOT_ALLOWED");
    const self = await prepare(s, { destination: s.key.address });
    expect(self.json().code).toBe("VALIDATION_FAILED");
    expect(await migratorQuery("SELECT 1 FROM transaction_records")).toHaveLength(0);
  });

  it("TXL-AC-11: a failed simulation ends in SIMULATION_FAILED and cannot be signed", async () => {
    const s = await setup({
      simulateTransaction: () => ({
        kind: "result",
        result: {
          context: { slot: 101 },
          value: {
            err: { InstructionError: [0, { Custom: 1 }] },
            logs: ["insufficient lamports"],
            unitsConsumed: 150,
            accounts: null,
          },
        },
      }),
    });
    const record = (await prepare(s)).json().data;
    expect(record).toMatchObject({ state: "SIMULATION_FAILED", failure: { reason: "SIMULATION_ERROR" } });
    expect(record.review.simulation.status).toBe("FAILED");
    expect(record.unsignedTransactionBase64).toBeNull();
    const signing = await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    expect(signing.json().code).toBe("TRANSACTION_STATE_CONFLICT");
  });

  it("TXL-AC-11: simulated balances that differ from the expected transfer fail the simulation", async () => {
    const s = await setup({
      simulateTransaction: () => ({
        kind: "result",
        result: {
          context: { slot: 101 },
          value: {
            err: null,
            logs: [],
            unitsConsumed: 150,
            accounts: [account(SOURCE_BALANCE - 1), account(1)],
          },
        },
      }),
    });
    const record = (await prepare(s)).json().data;
    expect(record).toMatchObject({ state: "SIMULATION_FAILED", failure: { reason: "EFFECTS_MISMATCH" } });
  });

  it("TXL-AC-12: a signed transaction that differs from the reviewed one is refused and nothing is sent", async () => {
    const s = await setup();
    const record = (await prepare(s)).json().data;
    await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const tampered = buildSolTransferTransaction({
      source: s.key.address as Address,
      destination: s.destination as Address,
      lamports: 999_999_999n,
      blockhash: DEVNET_GENESIS_HASH,
      lastValidBlockHeight: 1000n,
    });
    const signedTampered = await sign(s.key, Buffer.from(tampered.wireBytes).toString("base64"));
    const response = await callAs(api!, s.session, "POST", `/transactions/${record.id}/submit`, {
      signedTransactionBase64: signedTampered,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "TRANSACTION_MESSAGE_MISMATCH",
      details: { reason: "MESSAGE_MISMATCH" },
    });
    expect(api!.stub.calls.get("sendTransaction") ?? 0).toBe(0);
    const detail = (await callAs(api!, s.session, "GET", `/transactions/${record.id}`)).json().data;
    expect(detail.state).toBe("SIGNING_FAILED");
  });

  it("TXL-AC-12: an unsigned or wrongly signed transaction is refused", async () => {
    const s = await setup();
    const record = (await prepare(s)).json().data;
    await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const response = await callAs(api!, s.session, "POST", `/transactions/${record.id}/submit`, {
      signedTransactionBase64: record.unsignedTransactionBase64,
    });
    expect(response.json()).toMatchObject({
      code: "TRANSACTION_MESSAGE_MISMATCH",
      details: { reason: "SIGNATURE_INVALID" },
    });
    expect(api!.stub.calls.get("sendTransaction") ?? 0).toBe(0);
  });

  it("TXL-AC-13: cancelling or a wallet rejection sends nothing", async () => {
    const s = await setup();
    const toCancel = (await prepare(s)).json().data;
    const cancelled = await callAs(api!, s.session, "POST", `/transactions/${toCancel.id}/cancel`);
    expect(cancelled.json().data).toMatchObject({
      state: "CANCELLED",
      failure: { reason: "USER_CANCELLED" },
    });

    const toReject = (await prepare(s)).json().data;
    await callAs(api!, s.session, "POST", `/transactions/${toReject.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const rejected = await callAs(api!, s.session, "POST", `/transactions/${toReject.id}/signing-failed`, {
      reason: "USER_REJECTED",
    });
    expect(rejected.json().data).toMatchObject({
      state: "SIGNING_FAILED",
      failure: { reason: "USER_REJECTED" },
    });
    expect(api!.stub.calls.get("sendTransaction") ?? 0).toBe(0);

    const stranger = await api!.signIn();
    await api!.grantRole(stranger.userId, "admin");
    const third = (await prepare(s)).json().data;
    const notMine = await callAs(api!, stranger, "POST", `/transactions/${third.id}/cancel`);
    expect(notMine.json().code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("TXL-AC-05: a blockhash that expires before submission ends in EXPIRED without sending", async () => {
    const s = await setup({ getBlockHeight: () => ({ kind: "result", result: 1001 }) });
    const record = (await prepare(s)).json().data;
    await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const response = await callAs(api!, s.session, "POST", `/transactions/${record.id}/submit`, {
      signedTransactionBase64: await sign(s.key, record.unsignedTransactionBase64),
    });
    expect(response.json().data).toMatchObject({
      state: "EXPIRED",
      failure: { reason: "BLOCKHASH_EXPIRED" },
    });
    expect(api!.stub.calls.get("sendTransaction") ?? 0).toBe(0);
  });

  it("SPEC-004 amendment: a definitive preflight rejection ends in SUBMISSION_FAILED", async () => {
    const s = await setup({
      sendTransaction: () => ({
        kind: "rpc-error",
        code: -32002,
        message: "Transaction simulation failed: Blockhash not found",
        data: { err: "BlockhashNotFound", logs: [], accounts: null, unitsConsumed: 0 },
      }),
    });
    const record = (await prepare(s)).json().data;
    await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const response = await callAs(api!, s.session, "POST", `/transactions/${record.id}/submit`, {
      signedTransactionBase64: await sign(s.key, record.unsignedTransactionBase64),
    });
    expect(response.json().data).toMatchObject({
      state: "SUBMISSION_FAILED",
      failure: { reason: "SEND_REJECTED" },
    });
    expect(api!.stub.calls.get("sendTransaction")).toBe(1);
  });

  it("SPEC-004 amendment: an ambiguous send failure keeps SUBMITTED for the worker to decide", async () => {
    const s = await setup({ sendTransaction: () => ({ kind: "http-error", status: 503 }) });
    const record = (await prepare(s)).json().data;
    await callAs(api!, s.session, "POST", `/transactions/${record.id}/signing`, {
      acknowledgeUnknownPrograms: false,
    });
    const response = await callAs(api!, s.session, "POST", `/transactions/${record.id}/submit`, {
      signedTransactionBase64: await sign(s.key, record.unsignedTransactionBase64),
    });
    expect(response.json().data.state).toBe("SUBMITTED");
    const jobs = await api!.services.redis.keys(`bull:transactions.confirmation:confirm-${record.id}`);
    expect(jobs).toHaveLength(1);
  });
});
