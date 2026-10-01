import type { Cluster } from "@sct/network";
import type { Permission } from "@sct/validation";

/** Opaque transaction handle passed between repositories within one unit of work. */
export type Transaction = unknown;

export interface UnitOfWork {
  run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
}

export interface StoredChallenge {
  id: string;
  address: string;
  cluster: Cluster;
  nonce: string;
  message: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface ChallengeStore {
  create(
    challenge: Omit<StoredChallenge, "id" | "consumedAt"> & { requesterIp: string | null },
  ): Promise<string>;
  /** Loads and locks the challenge for the rest of the transaction. */
  lockById(id: string, transaction: Transaction): Promise<StoredChallenge | null>;
  markConsumed(id: string, at: Date, transaction: Transaction): Promise<void>;
}

export interface IdentityStore {
  findOrCreateUserByWallet(
    address: string,
    cluster: Cluster,
    at: Date,
    transaction: Transaction,
  ): Promise<{ userId: string; displayName: string | null; created: boolean }>;
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
}

export interface MembershipStore {
  findFirstActiveOrganization(userId: string, transaction?: Transaction): Promise<OrganizationSummary | null>;
  findOrganization(organizationId: string): Promise<OrganizationSummary | null>;
  loadPermissions(userId: string, organizationId: string): Promise<Permission[]>;
  /** Grants the owner role of the default organization if it has no owner yet. Returns true when granted. */
  grantBootstrapOwnerIfUnowned(
    userId: string,
    organizationSlug: string,
    transaction: Transaction,
  ): Promise<{ granted: boolean; organizationId: string | null }>;
  /** Grants a system role in the given organization when the user has no active membership anywhere. */
  grantDefaultRoleIfUnaffiliated(
    userId: string,
    organizationSlug: string,
    roleKey: string,
    transaction: Transaction,
  ): Promise<{ granted: boolean; organizationId: string | null }>;
}

export interface StoredSession {
  id: string;
  userId: string;
  displayName: string | null;
  walletAddress: string;
  activeOrganizationId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionStore {
  create(
    session: {
      tokenHash: Buffer;
      userId: string;
      walletAddress: string;
      activeOrganizationId: string | null;
      createdAt: Date;
      expiresAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
    },
    transaction: Transaction,
  ): Promise<string>;
  findByTokenHash(tokenHash: Buffer): Promise<StoredSession | null>;
  touch(sessionId: string, at: Date): Promise<void>;
  revoke(sessionId: string, at: Date): Promise<void>;
}

export interface SignatureVerifier {
  verify(address: string, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}
