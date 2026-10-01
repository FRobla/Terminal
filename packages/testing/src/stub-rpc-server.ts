import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Test-only JSON-RPC server used to exercise failure modes (rate limits, outages,
 * timeouts, malformed responses) that cannot be produced on demand against Devnet
 * (TESTING.md §7). Never used by runtime code.
 */
export type StubRpcBehavior =
  | { kind: "result"; result: unknown }
  | { kind: "http-error"; status: number; headers?: Record<string, string> }
  | { kind: "rpc-error"; code: number; message: string }
  | { kind: "hang" };

export type StubRpcHandler = (params: unknown[]) => StubRpcBehavior;

export interface StubRpcServer {
  url: string;
  /** Number of calls per method since start or the last reset. */
  calls: Map<string, number>;
  setHandler(method: string, handler: StubRpcHandler | StubRpcBehavior): void;
  reset(): void;
  close(): Promise<void>;
}

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

export async function startStubRpcServer(
  initialHandlers: Record<string, StubRpcHandler | StubRpcBehavior> = {},
): Promise<StubRpcServer> {
  const handlers = new Map<string, StubRpcHandler>();
  const calls = new Map<string, number>();
  const hanging = new Set<ServerResponse>();

  const setHandler = (method: string, handler: StubRpcHandler | StubRpcBehavior) => {
    handlers.set(method, typeof handler === "function" ? handler : () => handler);
  };
  const defaults: Record<string, StubRpcBehavior> = {
    getGenesisHash: { kind: "result", result: DEVNET_GENESIS_HASH },
    getVersion: { kind: "result", result: { "solana-core": "stub", "feature-set": 0 } },
    getSlot: { kind: "result", result: 1000 },
  };
  const applyDefaults = () => {
    handlers.clear();
    for (const [method, behavior] of Object.entries(defaults)) setHandler(method, behavior);
    for (const [method, handler] of Object.entries(initialHandlers)) setHandler(method, handler);
  };
  applyDefaults();

  const server: Server = createServer(async (request, response) => {
    const payload = JSON.parse(await readBody(request)) as {
      id: unknown;
      method: string;
      params?: unknown[];
    };
    calls.set(payload.method, (calls.get(payload.method) ?? 0) + 1);
    const handler = handlers.get(payload.method);
    const behavior: StubRpcBehavior = handler
      ? handler(payload.params ?? [])
      : { kind: "rpc-error", code: -32601, message: "Method not found" };

    switch (behavior.kind) {
      case "hang":
        hanging.add(response);
        return;
      case "http-error":
        response.writeHead(behavior.status, { "content-type": "application/json", ...behavior.headers });
        response.end(JSON.stringify({ error: "stub failure" }));
        return;
      case "rpc-error":
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            error: { code: behavior.code, message: behavior.message },
          }),
        );
        return;
      case "result":
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: behavior.result }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    setHandler,
    reset: () => {
      calls.clear();
      applyDefaults();
    },
    close: async () => {
      for (const response of hanging) response.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** `getBalance` response shape with a context slot. */
export function balanceResult(lamports: number | bigint, slot = 1000) {
  return { context: { slot, apiVersion: "stub" }, value: Number(lamports) };
}

/** `getTokenAccountsByOwner` jsonParsed response shape. */
export function tokenAccountsResult(
  accounts: Array<{
    pubkey: string;
    mint: string;
    owner: string;
    amount: string;
    decimals: number;
    program: "spl-token" | "spl-token-2022";
    state?: "initialized" | "frozen";
  }>,
  slot = 1000,
) {
  return {
    context: { slot, apiVersion: "stub" },
    value: accounts.map((account) => ({
      pubkey: account.pubkey,
      account: {
        executable: false,
        lamports: 2039280,
        owner:
          account.program === "spl-token"
            ? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            : "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        rentEpoch: 0,
        space: 165,
        data: {
          program: account.program,
          space: 165,
          parsed: {
            type: "account",
            info: {
              isNative: false,
              mint: account.mint,
              owner: account.owner,
              state: account.state ?? "initialized",
              tokenAmount: {
                amount: account.amount,
                decimals: account.decimals,
                uiAmount: null,
                uiAmountString: "0",
              },
            },
          },
        },
      },
    })),
  };
}
