import {
  ConcurrencyLimiter,
  isProviderError,
  RedisProviderHealthStore,
  RedisTokenBucketLimiter,
} from "@sct/providers";
import { KNOWN_GENESIS_HASHES } from "@sct/network";
import {
  ClusterIdentityReader,
  SignatureHistoryReader,
  SolanaRpcClient,
  SolBalanceReader,
  solanaRpcProviderDescriptor,
  TOKEN_PROGRAMS,
  TokenAccountReader,
} from "@sct/solana";
import { createTestKeyPair, integrationEnvironment } from "@sct/testing";
import { address } from "@solana/kit";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it as vitestIt } from "vitest";

/**
 * Real Devnet verification (TESTING.md §6). Opt-in with RUN_DEVNET_TESTS=true.
 * Expected values are never hardcoded: every reader result is compared with a raw
 * JSON-RPC call made in the same test.
 */
const RUN = process.env.RUN_DEVNET_TESTS === "true";
const DEVNET_RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
// Orca SOL/devUSDC Whirlpool on Devnet (DATA_SOURCES.md §4.5); its vaults are SPL token accounts it owns.
const TOKEN_OWNER_WITH_ACCOUNTS = address(
  process.env.DEVNET_TOKEN_OWNER ?? "3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt",
);

const RAW_RATE_LIMITED = "Raw Devnet RPC call was rate limited";

/**
 * The public Devnet RPC rate-limits aggressively. A rate-limited run is reported as
 * an explicit skip (never a silent pass), per TESTING.md §6.
 */
function it(name: string, test: () => Promise<void>) {
  vitestIt(name, async (context) => {
    try {
      await test();
    } catch (error) {
      const rateLimited =
        (isProviderError(error) && error.kind === "RATE_LIMITED") ||
        (error instanceof Error && error.message === RAW_RATE_LIMITED);
      if (rateLimited) context.skip("SKIPPED: public Devnet RPC rate limited (HTTP 429)");
      throw error;
    }
  });
}

async function rawRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(DEVNET_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (response.status === 429) throw new Error(RAW_RATE_LIMITED);
  const body = (await response.json()) as { result: T };
  return body.result;
}

describe.runIf(RUN)("@devnet wallet readers", () => {
  let redis: Redis;
  let client: SolanaRpcClient;
  const context = { requestId: "devnet-test" };

  beforeAll(async () => {
    redis = new Redis(integrationEnvironment.redisUrl);
    const health = new RedisProviderHealthStore(redis, "sct:test-health");
    client = new SolanaRpcClient(
      solanaRpcProviderDescriptor({
        id: "devnet-test",
        displayName: "Devnet",
        cluster: "devnet",
        endpoint: DEVNET_RPC_URL,
      }),
      {
        limiter: new RedisTokenBucketLimiter(redis, "sct:test-ratelimit"),
        health,
        concurrency: new ConcurrencyLimiter(2),
      },
    );
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("NET-AC-02: the public Devnet RPC reports the Devnet genesis hash", async () => {
    const identity = await new ClusterIdentityReader(client).read();
    expect(identity.genesisHash).toBe(KNOWN_GENESIS_HASHES.devnet);
    expect(identity.solanaCoreVersion).toEqual(expect.any(String));
  });

  it("WO-AC-03: the balance equals a raw getBalance call", async () => {
    const reading = await new SolBalanceReader(client).read(TOKEN_OWNER_WITH_ACCOUNTS, context);
    const raw = await rawRpc<{ value: number }>("getBalance", [
      TOKEN_OWNER_WITH_ACCOUNTS,
      { commitment: "confirmed" },
    ]);
    expect(reading.value.lamports).toBe(BigInt(raw.value));
    expect(reading.provenance).toMatchObject({
      network: "devnet",
      method: "getBalance",
      confidence: "AUTHORITATIVE",
    });
  });

  it("WO-AC-04: token accounts match raw queries of both token programs", async () => {
    const reading = await new TokenAccountReader(client).read(TOKEN_OWNER_WITH_ACCOUNTS, context);
    let rawCount = 0;
    for (const program of TOKEN_PROGRAMS) {
      const raw = await rawRpc<{ value: unknown[] }>("getTokenAccountsByOwner", [
        TOKEN_OWNER_WITH_ACCOUNTS,
        { programId: program.programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      rawCount += raw.value.length;
    }
    expect(reading.value.length).toBe(rawCount);
    expect(reading.value.length).toBeGreaterThan(0);
  });

  it("WO-AC-05: signatures match a raw getSignaturesForAddress call", async () => {
    const reading = await new SignatureHistoryReader(client).read(TOKEN_OWNER_WITH_ACCOUNTS, 5, context);
    const raw = await rawRpc<Array<{ signature: string }>>("getSignaturesForAddress", [
      TOKEN_OWNER_WITH_ACCOUNTS,
      { limit: 5, commitment: "confirmed" },
    ]);
    // Both calls may straddle a new transaction; the older overlap must agree.
    const readerSignatures = reading.value.map((entry) => entry.signature);
    const overlap = raw
      .map((entry) => entry.signature)
      .filter((signature) => readerSignatures.includes(signature));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it("WO-AC-09/10: a freshly generated address has zero balance, no token accounts, and no history", async () => {
    const fresh = (await createTestKeyPair()).address;
    const [balance, tokens, signatures] = await Promise.all([
      new SolBalanceReader(client).read(fresh, context),
      new TokenAccountReader(client).read(fresh, context),
      new SignatureHistoryReader(client).read(fresh, 5, context),
    ]);
    expect(balance.value.lamports).toBe(0n);
    expect(tokens.value).toEqual([]);
    expect(signatures.value).toEqual([]);
  });
});
