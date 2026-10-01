import { Writable } from "node:stream";
import { createDatabase } from "@sct/database";
import { createLogger } from "@sct/observability";
import {
  createTestKeyPair,
  integrationEnvironment,
  startStubRpcServer,
  type StubRpcBehavior,
  type StubRpcHandler,
  type TestKeyPair,
} from "@sct/testing";
import { Redis } from "ioredis";
import postgres from "postgres";
import { buildServer } from "../src/server";
import { createApiServices, type ApiConfig } from "../src/services";

/** Test-only harness: real PostgreSQL and Redis, stubbed Solana RPC for failure modes. */

export const TEST_ORIGIN = "http://localhost:3000";

const DYNAMIC_TABLES = [
  "auth_challenges",
  "sessions",
  "audit_events",
  "membership_roles",
  "organization_memberships",
  "user_wallet_identities",
  "user_preferences",
  "platform_settings",
  "users",
  "provider_health_checks",
];

export async function resetDynamicState(): Promise<void> {
  const sql = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(`TRUNCATE ${DYNAMIC_TABLES.join(", ")} CASCADE`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const redis = new Redis(integrationEnvironment.redisUrl);
  await redis.flushdb();
  await redis.quit();
}

export async function migratorQuery<T extends Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
) {
  const sql = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
  try {
    return (await sql.unsafe(query, params as never[])) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface TestApiOptions {
  rpcHandlers?: Record<string, StubRpcHandler | StubRpcBehavior>;
  config?: Partial<ApiConfig>;
  verifyCluster?: boolean;
}

export async function createTestApi(options: TestApiOptions = {}) {
  await resetDynamicState();
  const stub = await startStubRpcServer(options.rpcHandlers);
  const logLines: string[] = [];
  const logger = createLogger({
    service: "api-test",
    level: "debug",
    destination: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString());
        callback();
      },
    }),
  });
  const redis = new Redis(integrationEnvironment.redisUrl);
  const database = createDatabase(integrationEnvironment.applicationDatabaseUrl, { maxConnections: 5 });

  const config: ApiConfig = {
    APP_ENV: "ci",
    SOLANA_CLUSTER: "devnet",
    SOLANA_RPC_URL: stub.url,
    SOLANA_EXPECTED_GENESIS_HASH: undefined,
    PUBLIC_APP_ORIGIN: TEST_ORIGIN,
    AUTH_SECRET: Buffer.alloc(32, 9).toString("base64"),
    SESSION_TTL_SECONDS: 43200,
    SESSION_IDLE_TIMEOUT_SECONDS: 1800,
    BOOTSTRAP_OWNER_WALLET_ADDRESS: undefined,
    DEFAULT_MEMBER_ROLE: undefined,
    ...options.config,
  };
  const services = createApiServices(config, { redis, database, logger });
  const app = await buildServer(services, {
    rateLimit: { max: 10_000, timeWindowMs: 60_000 },
    authRateLimit: { max: 10_000, timeWindowMs: 60_000 },
  });
  if (options.verifyCluster ?? true) await services.clusterVerification.verify();

  async function signIn(keyPair?: TestKeyPair) {
    const identity = keyPair ?? (await createTestKeyPair());
    const challenge = await app.inject({
      method: "POST",
      url: "/api/v1/auth/siws/challenge",
      headers: { origin: TEST_ORIGIN },
      payload: { address: identity.address },
    });
    const { challengeId, message } = challenge.json().data as { challengeId: string; message: string };
    const bytes = new TextEncoder().encode(message);
    const signature = await identity.sign(bytes);
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/siws/verify",
      headers: { origin: TEST_ORIGIN },
      payload: {
        challengeId,
        address: identity.address,
        signedMessage: Buffer.from(bytes).toString("base64"),
        signature: Buffer.from(signature).toString("base64"),
        method: "signMessage",
      },
    });
    if (verify.statusCode !== 200) throw new Error(`Sign-in failed: ${verify.body}`);
    const cookie = verify.cookies.find((entry) => entry.name === services.cookie.name);
    if (!cookie) throw new Error("No session cookie");
    const cookies = { [services.cookie.name]: cookie.value };
    const session = await app.inject({ method: "GET", url: "/api/v1/auth/session", cookies });
    const data = session.json().data as { user: { id: string }; csrfToken: string };
    return { identity, cookies, userId: data.user.id, csrfToken: data.csrfToken };
  }

  /** Adds the user to the default organization with a system role and makes it the session's active organization. */
  async function grantRole(userId: string, roleKey: string) {
    const [membership] = await migratorQuery<{ id: string; organization_id: string }>(
      `INSERT INTO organization_memberships (id, organization_id, user_id)
       SELECT gen_random_uuid(), o.id, $1 FROM organizations o WHERE o.slug = 'default'
       ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active'
       RETURNING id, organization_id`,
      [userId],
    );
    if (!membership) throw new Error("Default organization missing; did the seed run?");
    await migratorQuery(
      `INSERT INTO membership_roles (membership_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.organization_id IS NULL AND r.key = $2
       ON CONFLICT DO NOTHING`,
      [membership.id, roleKey],
    );
    await migratorQuery(`UPDATE sessions SET active_organization_id = $1 WHERE user_id = $2`, [
      membership.organization_id,
      userId,
    ]);
    services.sessions.invalidatePermissions();
  }

  return {
    app,
    services,
    stub,
    logLines,
    signIn,
    grantRole,
    async close() {
      services.clusterVerification.stop();
      await app.close();
      await services.close();
      await stub.close();
      await redis.quit();
      await database.close();
    },
  };
}

export type TestApi = Awaited<ReturnType<typeof createTestApi>>;

export type TestSession = Awaited<ReturnType<TestApi["signIn"]>>;

/** Calls an API route as a signed-in session (or anonymously), adding the origin and CSRF token. */
export function callAs(
  testApi: TestApi,
  session: TestSession | null,
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: unknown,
) {
  return testApi.app.inject({
    method,
    url: `/api/v1${url}`,
    ...(session ? { cookies: session.cookies } : {}),
    headers: {
      origin: TEST_ORIGIN,
      ...(session && method !== "GET" ? { "x-csrf-token": session.csrfToken } : {}),
    },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

/** The id of the given session, as listed by `/me/sessions`. */
export async function currentSessionId(testApi: TestApi, session: TestSession): Promise<string> {
  const sessions = (await callAs(testApi, session, "GET", "/me/sessions")).json().data as Array<{
    id: string;
    current: boolean;
  }>;
  const current = sessions.find((entry) => entry.current);
  if (!current) throw new Error("No current session listed");
  return current.id;
}
