import {
  ConcurrencyLimiter,
  isProviderError,
  RedisProviderHealthStore,
  RedisTokenBucketLimiter,
} from "@sct/providers";
import {
  buildSolTransferTransaction,
  decodeMessage,
  decodeSystemTransfer,
  decodeWireTransaction,
  encodeWireTransaction,
  MultipleBalancesReader,
  solanaRpcProviderDescriptor,
  SolanaRpcClient,
  solChangeOf,
  TransactionChainReaders,
  TransactionDetailsReader,
} from "@sct/solana";
import { createTestKeyPair, integrationEnvironment } from "@sct/testing";
import { effectsMatch, observedEffects, solTransferEffects } from "@sct/transactions";
import type { Address } from "@solana/kit";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real Devnet SOL transfer (TESTING.md §6). Opt-in with RUN_DEVNET_TESTS=true. A disposable
 * keypair is funded by the faucet; when the faucet refuses, the test is skipped with a reason.
 */
const RUN = process.env.RUN_DEVNET_TESTS === "true";
const DEVNET_RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const AIRDROP_LAMPORTS = 20_000_000;
const TRANSFER_LAMPORTS = 1_000_000n;

async function rawRpc<T>(
  method: string,
  params: unknown[],
): Promise<{ result?: T; error?: { message: string } }> {
  const response = await fetch(DEVNET_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (response.status === 429) return { error: { message: "HTTP 429" } };
  return (await response.json()) as { result?: T; error?: { message: string } };
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}

describe.runIf(RUN)("@devnet SOL transfer lifecycle", () => {
  let redis: Redis;
  let chain: TransactionChainReaders;
  let balances: MultipleBalancesReader;
  let details: TransactionDetailsReader;
  const context = { requestId: "devnet-transfer-test" };

  beforeAll(() => {
    redis = new Redis(integrationEnvironment.redisUrl);
    const client = new SolanaRpcClient(
      solanaRpcProviderDescriptor({
        id: "devnet-transfer-test",
        displayName: "Devnet",
        cluster: "devnet",
        endpoint: DEVNET_RPC_URL,
      }),
      {
        limiter: new RedisTokenBucketLimiter(redis, "sct:test-ratelimit"),
        health: new RedisProviderHealthStore(redis, "sct:test-health"),
        concurrency: new ConcurrencyLimiter(2),
      },
    );
    chain = new TransactionChainReaders(client);
    balances = new MultipleBalancesReader(client);
    details = new TransactionDetailsReader(client);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("TXL-AC-11: simulated post-balances include amount and fee (unsigned simulation from a funded Devnet account)", async (testContext) => {
    // A recent fee payer is a funded, system-owned account; simulation needs no signature (sigVerify: false).
    const recent = await rawRpc<Array<{ signature: string }>>("getSignaturesForAddress", [
      "Vote111111111111111111111111111111111111111",
      { limit: 1 },
    ]);
    const signature = recent.result?.[0]?.signature;
    if (!signature)
      testContext.skip(`SKIPPED: no recent Devnet transaction (${recent.error?.message ?? "empty"})`);
    const landed = (await details.read(signature!, "confirmed", context)).value;
    const feePayer = landed?.accountKeys[0];
    if (!feePayer) testContext.skip("SKIPPED: the recent transaction is not available");
    const destination = (await createTestKeyPair()).address;
    try {
      const blockhash = await chain.latestBlockhash(context);
      const built = buildSolTransferTransaction({
        source: feePayer as Address,
        destination: destination as Address,
        lamports: TRANSFER_LAMPORTS,
        blockhash: blockhash.value.blockhash,
        lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
      });
      const accounts = [feePayer!, destination];
      const [before, fee, simulation] = await Promise.all([
        balances.read(accounts as Address[], context),
        chain.feeForMessage(built.messageBytes, context),
        chain.simulate(built.wireBytes, accounts, context),
      ]);
      if (simulation.value.error !== null) {
        testContext.skip(
          `SKIPPED: the sampled account cannot pay (${JSON.stringify(simulation.value.error, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))})`,
        );
      }
      const expected = solTransferEffects(
        [{ source: feePayer!, destination, lamports: TRANSFER_LAMPORTS }],
        feePayer!,
        fee.value ?? 0n,
      );
      const observed = observedEffects(
        accounts,
        before.value.map((row) => row.lamports),
        simulation.value.postLamports,
      );
      // The destination receives exactly the amount; the source pays the amount plus the base fee.
      expect(observed.get(destination)).toBe(TRANSFER_LAMPORTS);
      expect(fee.value).toBeGreaterThan(0n);
      expect(observed.get(feePayer!)).toBe(-(TRANSFER_LAMPORTS + fee.value!));
      expect(effectsMatch(expected, observed)).toBe(true);
    } catch (error) {
      if (isProviderError(error) && error.kind === "RATE_LIMITED") {
        testContext.skip("SKIPPED: public Devnet RPC rate limited (HTTP 429)");
      }
      throw error;
    }
  }, 60_000);

  it("TXL-AC-07/14: simulation effects include the fee, and the finalized transfer reconciles", async (testContext) => {
    const source = await createTestKeyPair();
    const destination = (await createTestKeyPair()).address;
    const airdrop = await rawRpc<string>("requestAirdrop", [
      source.address,
      AIRDROP_LAMPORTS,
      { commitment: "confirmed" },
    ]);
    if (!airdrop.result)
      testContext.skip(`SKIPPED: faucet unavailable (${airdrop.error?.message ?? "no signature"})`);
    const funded = await waitFor(async () => {
      const reading = await balances.read([source.address as Address], context);
      return reading.value[0]!.lamports > 0n ? reading.value[0]!.lamports : null;
    }, 60_000);
    if (funded === null) testContext.skip("SKIPPED: faucet airdrop did not confirm within 60 s");

    try {
      const blockhash = await chain.latestBlockhash(context);
      const built = buildSolTransferTransaction({
        source: source.address as Address,
        destination: destination as Address,
        lamports: TRANSFER_LAMPORTS,
        blockhash: blockhash.value.blockhash,
        lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
      });
      const accounts = [source.address, destination];
      const [before, fee, simulation] = await Promise.all([
        balances.read(accounts as Address[], context),
        chain.feeForMessage(built.messageBytes, context),
        chain.simulate(built.wireBytes, accounts, context),
      ]);
      expect(simulation.value.error).toBeNull();
      expect(fee.value).not.toBeNull();
      const decoded = decodeMessage(built.messageBytes);
      const transfers = decoded.instructions.flatMap((instruction) => {
        const transfer = decodeSystemTransfer(instruction);
        return transfer ? [transfer] : [];
      });
      const expected = solTransferEffects(transfers, decoded.feePayer, fee.value!);
      // The amount and the fee are both reflected in the simulated post-balances.
      expect(
        effectsMatch(
          expected,
          observedEffects(
            accounts,
            before.value.map((row) => row.lamports),
            simulation.value.postLamports,
          ),
        ),
      ).toBe(true);

      const unsigned = decodeWireTransaction(built.wireBytes);
      const signed = encodeWireTransaction({
        ...unsigned,
        signatures: { [source.address]: new Uint8Array(await source.sign(unsigned.messageBytes)) },
      });
      const signature = await chain.send(signed);

      const finalized = await waitFor(async () => {
        const [status] = await chain.signatureStatuses([signature]);
        return status?.confirmationStatus === "finalized" ? status : null;
      }, 90_000);
      if (finalized === null) testContext.skip("SKIPPED: the transfer did not finalize within 90 s");
      expect(finalized!.error).toBeNull();

      const landed = await waitFor(
        async () => (await details.read(signature, "finalized", context)).value,
        30_000,
      );
      expect(landed).not.toBeNull();
      const observed = new Map(accounts.map((account) => [account, solChangeOf(landed!, account) ?? 0n]));
      expect(effectsMatch(expected, observed)).toBe(true);
    } catch (error) {
      if (isProviderError(error) && error.kind === "RATE_LIMITED") {
        testContext.skip("SKIPPED: public Devnet RPC rate limited (HTTP 429)");
      }
      throw error;
    }
  }, 240_000);
});
