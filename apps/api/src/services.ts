import type { ApiEnvironment } from "@sct/config";
import type { DatabaseHandle } from "@sct/database";
import type { Logger } from "@sct/observability";
import {
  ConcurrencyLimiter,
  redactEndpoint,
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
import { AnnouncementService } from "./announcements/application/announcement-service";
import { AnnouncementRepository } from "./announcements/infrastructure/announcement-repository";
import { AuditLog } from "./audit/application/audit-log";
import { AuditEventRepository } from "./audit/infrastructure/audit-event-repository";
import { SessionAdministration } from "./auth/application/session-administration";
import { SessionService } from "./auth/application/session-service";
import { SignInService } from "./auth/application/sign-in-service";
import { sessionCookieSettings } from "./auth/http/session-cookie";
import { ChallengeRepository } from "./auth/infrastructure/challenge-repository";
import { Ed25519SignatureVerifier } from "./auth/infrastructure/ed25519-signature-verifier";
import { IdentityRepository } from "./auth/infrastructure/identity-repository";
import { SessionRepository } from "./auth/infrastructure/session-repository";
import { CacheMaintenance } from "./developer/application/cache-maintenance";
import { RouteCatalog } from "./developer/application/route-catalog";
import { MemberAdministration } from "./organizations/application/member-administration";
import { OrganizationAdministration } from "./organizations/application/organization-administration";
import { MemberDirectoryRepository } from "./organizations/infrastructure/member-directory-repository";
import { MembershipRepository } from "./organizations/infrastructure/membership-repository";
import { OrganizationRepository } from "./organizations/infrastructure/organization-repository";
import { DatabaseUnitOfWork } from "./platform/database-unit-of-work";
import { ClusterVerificationService } from "./system/application/cluster-verification-service";
import { PlatformOverview } from "./system/application/platform-overview";
import { RuntimeInspection } from "./system/application/runtime-inspection";
import { SystemAdministration } from "./system/application/system-administration";
import { BullmqProviderHealthQueue } from "./system/infrastructure/bullmq-queue-inspector";
import {
  PlatformStatisticsRepository,
  ProviderHistoryRepository,
} from "./system/infrastructure/platform-statistics-repository";
import { PostgresInspector } from "./system/infrastructure/postgres-inspector";
import { RedisInspector } from "./system/infrastructure/redis-inspector";
import { PreferenceService } from "./users/application/preference-service";
import { ProfileService } from "./users/application/profile-service";
import { PreferenceRepository } from "./users/infrastructure/preference-repository";
import { ProfileRepository } from "./users/infrastructure/profile-repository";
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
  | "DEFAULT_MEMBER_ROLE"
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
      defaultMemberRole: config.DEFAULT_MEMBER_ROLE,
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

  const overviewCache = new RedisOverviewCache(redis);
  const getWalletOverview = new GetWalletOverview(
    config.SOLANA_CLUSTER,
    {
      solBalance: new SolBalanceReader(rpcClient),
      tokenAccounts: new TokenAccountReader(rpcClient),
      signatures: new SignatureHistoryReader(rpcClient),
    },
    overviewCache,
  );

  // SPEC-025 — user settings
  const unitOfWork = new DatabaseUnitOfWork(db);
  const idle = { idleTimeoutSeconds: config.SESSION_IDLE_TIMEOUT_SECONDS };
  const sessionAdministration = new SessionAdministration(idle, { directory: sessionStore, audit });
  const profiles = new ProfileService({ profiles: new ProfileRepository(db), audit });
  const preferences = new PreferenceService({ preferences: new PreferenceRepository(db) });

  // SPEC-026 — owner console
  const permissionCache = { invalidatePermissions: () => sessions.invalidatePermissions() };
  const memberAdministration = new MemberAdministration(idle, {
    unitOfWork,
    members: new MemberDirectoryRepository(db),
    sessions: sessionAdministration,
    permissionCache,
    audit,
  });
  const organizationAdministration = new OrganizationAdministration({
    unitOfWork,
    organizations: new OrganizationRepository(db),
    audit,
    onOrganizationChanged: () => sessions.invalidatePermissions(),
  });
  const announcements = new AnnouncementService({ unitOfWork, store: new AnnouncementRepository(db), audit });
  const pingRedis = async () => {
    await redis.ping();
  };
  const platformOverview = new PlatformOverview(idle, {
    statistics: new PlatformStatisticsRepository(db),
    readiness: {
      pingDatabase: database.ping,
      pingRedis,
      isClusterVerified: () => clusterVerification.isVerified(),
    },
    clusterVerification,
    rpcProviderName: primaryRpcProvider.displayName,
    providers: [primaryRpcProvider],
    health,
  });
  const runtimeInspection = new RuntimeInspection(
    {
      startedAt: new Date(),
      // Allowlist only: secrets, credentials, and connection strings are never listed (OWN-AC-12).
      configuration: {
        appEnv: config.APP_ENV,
        cluster: config.SOLANA_CLUSTER,
        publicAppOrigin: config.PUBLIC_APP_ORIGIN,
        rpcProvider: primaryRpcProvider.displayName,
        rpcEndpoint: redactEndpoint(config.SOLANA_RPC_URL),
        sessionTtlSeconds: config.SESSION_TTL_SECONDS,
        sessionIdleTimeoutSeconds: config.SESSION_IDLE_TIMEOUT_SECONDS,
        bootstrapOwnerConfigured: config.BOOTSTRAP_OWNER_WALLET_ADDRESS !== undefined,
        defaultMemberRole: config.DEFAULT_MEMBER_ROLE ?? null,
        openApiExposed: config.APP_ENV !== "production",
      },
    },
    { database: new PostgresInspector(db), redis: new RedisInspector(redis), logger },
  );
  const providerHealthQueue = new BullmqProviderHealthQueue(redis);
  const systemAdministration = new SystemAdministration({
    clusterVerification,
    rpcProviderName: primaryRpcProvider.displayName,
    queues: [providerHealthQueue],
    audit,
    logger,
  });
  const cacheMaintenance = new CacheMaintenance({
    caches: {
      "wallet-overview": overviewCache,
      permissions: { purge: async () => sessions.invalidatePermissions() },
    },
    audit,
  });

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
    pingRedis,
    sessionAdministration,
    profiles,
    preferences,
    memberAdministration,
    organizationAdministration,
    announcements,
    platformOverview,
    runtimeInspection,
    providerHistory: new ProviderHistoryRepository(db),
    providerHealthQueue,
    systemAdministration,
    cacheMaintenance,
    routeCatalog: new RouteCatalog(),
    /** Releases resources owned by the services (the shared Redis and database handles are closed by the caller). */
    async close() {
      await providerHealthQueue.close();
    },
  };
}

export type ApiServices = ReturnType<typeof createApiServices>;
