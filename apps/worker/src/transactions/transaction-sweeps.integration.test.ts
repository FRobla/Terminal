import { Writable } from "node:stream";
import { AuditLog, DrizzleAuditEventWriter } from "@sct/audit";
import { createDatabase } from "@sct/database";
import { createLogger, newRequestContext, runWithRequestContext } from "@sct/observability";
import type { SignatureStatus, TransactionDetails } from "@sct/solana";
import { createTestKeyPair, integrationEnvironment } from "@sct/testing";
import {
  DrizzleUnitOfWork,
  messageHash,
  TransactionRepository,
  TransactionTransitions,
  type TransactionRecord,
} from "@sct/transactions";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RECONCILIATION_DEADLINE_MS, TransactionSweeps, type SweepChain } from "./transaction-sweeps";

const logger = createLogger({
  service: "worker-test",
  level: "error",
  destination: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
});

let database: ReturnType<typeof createDatabase>;
let admin: postgres.Sql;
let store: TransactionRepository;
let transitions: TransactionTransitions;
let organizationId: string;
let userId: string;
let walletId: string;
let source: string;
let destination: string;

const LAMPORTS = 1_000n;
const FEE = 5_000n;

interface FakeChain extends SweepChain {
  statuses: Map<string, SignatureStatus>;
  height: bigint;
  rebroadcasts: number;
  details: Map<string, TransactionDetails>;
}

function fakeChain(): FakeChain {
  const chain: FakeChain = {
    statuses: new Map(),
    height: 100n,
    rebroadcasts: 0,
    details: new Map(),
    signatureStatuses: async (signatures) =>
      signatures.map((signature) => chain.statuses.get(signature) ?? null),
    blockHeight: async () => chain.height,
    rebroadcast: async () => {
      chain.rebroadcasts += 1;
    },
    transaction: async (signature) => ({
      value: chain.details.get(signature) ?? null,
      provenance: {} as never,
    }),
  };
  return chain;
}

/** A record already submitted by the API, with a signature and expected effects. */
async function submittedRecord(signature: string): Promise<TransactionRecord> {
  const system = { actor: { type: "system" as const } };
  const message = new Uint8Array([1, 2, 3, signature.length]);
  let record: TransactionRecord | null = await transitions.create(
    {
      organizationId,
      initiatedByUserId: userId,
      walletId,
      cluster: "devnet",
      purpose: "sol-transfer",
      feePayer: source,
      signers: [source],
      intent: { destination, lamports: LAMPORTS.toString() },
      expectedEffects: { [source]: (-(LAMPORTS + FEE)).toString(), [destination]: LAMPORTS.toString() },
      messageBytes: message,
      messageHash: messageHash(message),
      unsignedTransaction: message,
      recentBlockhash: "hash",
      lastValidBlockHeight: 150n,
      idempotencyKey: `sweep-${signature}`,
      createdAt: new Date(),
    },
    system.actor,
  );
  for (const state of ["SIMULATING", "SIMULATED", "AWAITING_SIGNATURE", "SIGNING"] as const) {
    record = await transitions.apply(record!, state, system);
  }
  return (await transitions.apply(record!, "SUBMITTED", {
    ...system,
    patch: { signature, signedTransaction: message, submittedAt: new Date(), lastSentAt: new Date(0) },
  }))!;
}

function details(sourceDelta: bigint, destinationDelta: bigint): TransactionDetails {
  return {
    slot: 10n,
    blockTime: null,
    feeLamports: FEE,
    accountKeys: [source, destination, "11111111111111111111111111111111"],
    preBalances: [10_000_000n, 0n, 1n],
    postBalances: [10_000_000n + sourceDelta, destinationDelta, 1n],
    error: null,
  };
}

const sweep = (chain: FakeChain, now?: () => Date) =>
  new TransactionSweeps(
    { cluster: "devnet" },
    { store, transitions, chain, logger, ...(now ? { now } : {}) },
  );

const inJob = <T>(work: () => Promise<T>) =>
  runWithRequestContext(
    newRequestContext({ requestId: "job:test", feature: "transactions", operation: "sweep" }),
    work,
  );

beforeAll(async () => {
  database = createDatabase(integrationEnvironment.applicationDatabaseUrl, { maxConnections: 3 });
  admin = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
  store = new TransactionRepository(database.db);
  transitions = new TransactionTransitions(
    { cluster: "devnet" },
    {
      unitOfWork: new DrizzleUnitOfWork(database.db),
      store,
      audit: new AuditLog(new DrizzleAuditEventWriter(database.db)),
    },
  );
});

beforeEach(async () => {
  source = (await createTestKeyPair()).address;
  destination = (await createTestKeyPair()).address;
  const [org] = await admin`SELECT id FROM organizations WHERE slug = 'default'`;
  organizationId = org!.id as string;
  const [user] = await admin`INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`;
  userId = user!.id as string;
  const [wallet] = await admin`
    INSERT INTO managed_wallets (id, organization_id, address, cluster, label, category, custody_type, created_by_user_id)
    VALUES (gen_random_uuid(), ${organizationId}, ${source}, 'devnet', 'Sweep test', 'TREASURY', 'BROWSER_WALLET', ${userId})
    RETURNING id`;
  walletId = wallet!.id as string;
});

afterEach(async () => {
  const ids = (await admin`SELECT id FROM transaction_records WHERE wallet_id = ${walletId}`).map(
    (row) => row.id as string,
  );
  if (ids.length > 0) {
    // The migrator role may clean up the append-only history in tests.
    await admin`DELETE FROM transaction_state_transitions WHERE transaction_id IN ${admin(ids)}`;
    await admin`DELETE FROM audit_events WHERE resource_id IN ${admin(ids)}`;
    await admin`DELETE FROM transaction_records WHERE id IN ${admin(ids)}`;
  }
  await admin`DELETE FROM managed_wallets WHERE id = ${walletId}`;
  await admin`DELETE FROM users WHERE id = ${userId}`;
});

afterAll(async () => {
  await database.close();
  await admin.end({ timeout: 5 });
});

describe("Transaction confirmation sweep (SPEC-004 rule 7)", () => {
  it("TXL-AC-06/09: a confirmed signature moves to CONFIRMED; an on-chain error to CONFIRMATION_FAILED, audited as system", async () => {
    const ok = await submittedRecord("sig-ok");
    const bad = await submittedRecord("sig-bad");
    const chain = fakeChain();
    chain.statuses.set("sig-ok", { slot: 5n, error: null, confirmationStatus: "confirmed" });
    chain.statuses.set("sig-bad", {
      slot: 5n,
      error: { InstructionError: [0, { Custom: 1n }] },
      confirmationStatus: "confirmed",
    });
    await inJob(() => sweep(chain).confirm());

    expect((await store.find(ok.id))?.state).toBe("CONFIRMED");
    const failed = await store.find(bad.id);
    expect(failed).toMatchObject({
      state: "CONFIRMATION_FAILED",
      failure: { reason: "ON_CHAIN_ERROR", message: '{"InstructionError":[0,{"Custom":"1"}]}' },
    });
    const history = (await store.history(ok.id)).map((change) => change.toState);
    expect(history.slice(-3)).toEqual(["SUBMITTED", "CONFIRMING", "CONFIRMED"]);
    const audit = await admin`
      SELECT action, actor_type, organization_id, request_id FROM audit_events
      WHERE resource_id = ${ok.id} ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit[0]).toEqual({
      action: "transaction.confirmed",
      actor_type: "system",
      organization_id: organizationId,
      request_id: "job:test",
    });
  });

  it("TXL-AC-05: an unseen signature past its last valid block height ends in EXPIRED, not SUBMISSION_FAILED", async () => {
    const record = await submittedRecord("sig-expired");
    const chain = fakeChain();
    chain.height = 151n;
    await inJob(() => sweep(chain).confirm());
    expect(await store.find(record.id)).toMatchObject({
      state: "EXPIRED",
      failure: { reason: "BLOCKHASH_EXPIRED" },
    });
    expect(chain.rebroadcasts).toBe(0);
  });

  it("SPEC-004 amendment: an unseen signature with a valid blockhash is re-broadcast at most every 2 s", async () => {
    const record = await submittedRecord("sig-pending");
    const chain = fakeChain();
    let now = Date.now();
    const clock = () => new Date(now);
    await inJob(() => sweep(chain, clock).confirm());
    expect(chain.rebroadcasts).toBe(1);
    now += 1_000;
    await inJob(() => sweep(chain, clock).confirm());
    expect(chain.rebroadcasts).toBe(1);
    now += 1_500;
    await inJob(() => sweep(chain, clock).confirm());
    expect(chain.rebroadcasts).toBe(2);
    expect((await store.find(record.id))?.state).toBe("CONFIRMING");
  });
});

describe("Transaction reconciliation sweep (SPEC-004 rule 8)", () => {
  async function confirmed(signature: string) {
    const record = await submittedRecord(signature);
    const chain = fakeChain();
    chain.statuses.set(signature, { slot: 5n, error: null, confirmationStatus: "confirmed" });
    await inJob(() => sweep(chain).confirm());
    return record;
  }

  it("TXL-AC-07: finalized balances that match the expected effects reconcile", async () => {
    const record = await confirmed("sig-match");
    const chain = fakeChain();
    chain.statuses.set("sig-match", { slot: 6n, error: null, confirmationStatus: "finalized" });
    chain.details.set("sig-match", details(-(LAMPORTS + FEE), LAMPORTS));
    await inJob(() => sweep(chain).reconcile({ requestId: "job:test" }));
    const reconciled = await store.find(record.id);
    expect(reconciled?.state).toBe("RECONCILED");
    expect(reconciled?.reconciliation).toMatchObject({ matched: true });
  });

  it("TXL-AC-07: a divergence requires reconciliation and raises the interim alert", async () => {
    const record = await confirmed("sig-diverge");
    const chain = fakeChain();
    chain.statuses.set("sig-diverge", { slot: 6n, error: null, confirmationStatus: "finalized" });
    chain.details.set("sig-diverge", details(-(LAMPORTS + FEE + 1n), LAMPORTS));
    await inJob(() => sweep(chain).reconcile({ requestId: "job:test" }));
    expect(await store.find(record.id)).toMatchObject({
      state: "RECONCILIATION_REQUIRED",
      reconciliation: { matched: false },
    });
    const [audit] = await admin`
      SELECT result FROM audit_events WHERE resource_id = ${record.id}
      AND action = 'transaction.reconciliation_required'`;
    expect(audit?.result).toBe("failure");
  });

  it("SPEC-004 amendment: no finalized data within 10 minutes ends in RECONCILIATION_FAILED", async () => {
    const record = await confirmed("sig-stuck");
    const chain = fakeChain();
    chain.statuses.set("sig-stuck", { slot: 6n, error: null, confirmationStatus: "confirmed" });
    await inJob(() => sweep(chain).reconcile({ requestId: "job:test" }));
    expect((await store.find(record.id))?.state).toBe("CONFIRMED");
    const later = () => new Date(Date.now() + RECONCILIATION_DEADLINE_MS + 1_000);
    await inJob(() => sweep(chain, later).reconcile({ requestId: "job:test" }));
    expect(await store.find(record.id)).toMatchObject({
      state: "RECONCILIATION_FAILED",
      failure: { reason: "DATA_UNAVAILABLE" },
    });
  });
});
