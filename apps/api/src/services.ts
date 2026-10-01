import type { ApiEnvironment } from "@sct/config";
import type { DatabaseHandle } from "@sct/database";
import type { Logger } from "@sct/observability";
import {
  ConcurrencyLimiter,
  RedisProviderHealthStore,
  RedisTokenBucketLimiter,
  type ProviderDescriptor,
  type ProviderHealthStore,
} from "@sct/providers";
import {
  ClusterIdentityReader,
  PRIMARY_RPC_PROVIDER_ID,
  SignatureHistoryReader,
  SolanaRpcClient,
  SolBalanceReader,
  solanaRpcProviderDescriptor,
  TokenAccountReader,
} from "@sct/solana";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { Redis } from "ioredis";
import { AuditLog } from "./audit/application/audit-log";
import { AuditEventRepository } from "./audit/infrastructure/audit-event-repository";
import { SessionService } from "./auth/application/session-service";
import { SignInService } from "./auth/application/sign-in-service";
import { sessionCookieSettings } from "./auth/http/session-cookie";
import { ChallengeRepository } from "./auth/infrastructure/challenge-repository";
import { Ed25519SignatureVerifier } from "./auth/infrastructure/ed25519-signature-verifier";
import { IdentityRepository } from "./auth/infrastructure/identity-repository";
import { SessionRepository } from "./auth/infrastructure/session-repository";
import { MembershipRepository } from "./organizations/infrastructure/membership-repository";
import { DatabaseUnitOfWork } from "./platform/database-unit-of-work";
import { ClusterVerificationService } from "./system/application/cluster-verification-service";
import { GetWalletOverview } from "./wallets/application/get-wallet-overview";
import { RedisOverviewCache } from "./wallets/infrastructure/redis-overview-cache";

export type ApiConfig = Pick<
  ApiEnvironment,
  | "APP_ENV"
  | "SOLANA_CLUSTER"
  | "SOLANA_RPC_URL"
  | "SOLANA_EXPECTED_GENESIS_HASH"
  | "PUBLIC_APP_ORIGIN"
  | "AUTH_SECRET"
  | "SESSION_TTL_SECONDS"
  | "SESSION_IDLE_TIMEOUT_SECONDS"
  | "BOOTSTRAP_OWNER_WALLET_ADDRESS"
>;

export interface ApiInfrastructure {
  redis: Redis;
  database: DatabaseHandle;
  logger: Logger;
  /** Overrides the Kit RPC client (tests point it at a stub server). */
  rpc?: Rpc<SolanaRpcApi>;
}

/** Composition root: wires ports to adapters. No business logic lives here. */
export function createApiServices(config: ApiConfig, infrastructure: ApiInfrastructure) {
  const { redis, database, logger } = infrastructure;
  const db = database.db;

  const health: ProviderHealthStore = new RedisProviderHealthStore(redis);
  const primaryRpcProvider: ProviderDescriptor = solanaRpcProviderDescriptor({
    id: PRIMARY_RPC_PROVIDER_ID,
    displayName: "Solana public RPC",
    cluster: config.SOLANA_CLUSTER,
    endpoint: config.SOLANA_RPC_URL,
  });
  const rpcClient = new SolanaRpcClient(
    primaryRpcProvider,
    {
      limiter: new RedisTokenBucketLimiter(redis),
      health,
      concurrency: new ConcurrencyLimiter(primaryRpcProvider.budget.maxConcurrency),
      onInternalError: (error) => logger.warn({ err: error }, "Provider health bookkeeping failed"),
    },
    infrastructure.rpc,
  );

  const auditRepository = new AuditEventRepository(db);
  const audit = new AuditLog(auditRepository);
  const memberships = new MembershipRepository(db);
  const sessionStore = new SessionRepository(db);
  const csrfSecret = Buffer.from(config.AUTH_SECRET, "base64");

  const sessions = new SessionService(
    { idleTimeoutSeconds: config.SESSION_IDLE_TIMEOUT_SECONDS, csrfSecret },
    { sessions: sessionStore, memberships },
  );
  const signIn = new SignInService(
    {
      cluster: config.SOLANA_CLUSTER,
      publicAppOrigin: config.PUBLIC_APP_ORIGIN,
      sessionTtlSeconds: config.SESSION_TTL_SECONDS,
      bootstrapOwnerWalletAddress: config.BOOTSTRAP_OWNER_WALLET_ADDRESS,
    },
    {
      unitOfWork: new DatabaseUnitOfWork(db),
      challenges: new ChallengeRepository(db),
      identities: new IdentityRepository(),
      memberships,
      sessions: sessionStore,
      verifier: new Ed25519SignatureVerifier(),
      audit,
    },
  );

  const clusterVerification = new ClusterVerificationService(
    {
      cluster: config.SOLANA_CLUSTER,
      localnetGenesisHash: config.SOLANA_EXPECTED_GENESIS_HASH,
      providerId: primaryRpcProvider.id,
    },
    { reader: new ClusterIdentityReader(rpcClient), health, logger },
  );

  const getWalletOverview = new GetWalletOverview(
    config.SOLANA_CLUSTER,
    {
      solBalance: new SolBalanceReader(rpcClient),
      tokenAccounts: new TokenAccountReader(rpcClient),
      signatures: new SignatureHistoryReader(rpcClient),
    },
    new RedisOverviewCache(redis),
  );

  return {
    config,
    logger,
    redis,
    database,
    health,
    providers: [primaryRpcProvider] as const,
    primaryRpcProvider,
    audit,
    auditRepository,
    sessions,
    signIn,
    csrfSecret,
    cookie: sessionCookieSettings(config.PUBLIC_APP_ORIGIN),
    clusterVerification,
    getWalletOverview,
  };
}

export type ApiServices = ReturnType<typeof createApiServices>;
