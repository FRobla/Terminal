import type { Address } from "@solana/kit";
import type { Cluster } from "@sct/network";
import type { AddressBalance, ReadContext, RpcReading } from "@sct/solana";
import type {
  CustodyType,
  IndexedTransaction,
  Sourced,
  WalletCategory,
  WalletRole,
  WalletStatus,
} from "@sct/validation";
import type { Transaction } from "../../auth/application/ports";
import type { OwnershipChallenge } from "../domain/ownership-challenge";

/** SPEC-009 — persistence and infrastructure ports of the wallet registry. */

export interface WalletAssignmentRecord {
  userId: string;
  displayName: string | null;
  walletAddress: string | null;
  role: WalletRole;
  assignedAt: Date;
}

export interface WalletSyncRecord {
  newestSignature: string | null;
  oldestSignature: string | null;
  oldestIndexedBlockTime: Date | null;
  backfillComplete: boolean;
  indexedCount: number;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
}

export interface WalletRecord {
  id: string;
  organizationId: string;
  address: string;
  cluster: Cluster;
  label: string;
  purpose: string | null;
  category: WalletCategory;
  custodyType: CustodyType;
  notes: string | null;
  status: WalletStatus;
  createdBy: { id: string; displayName: string | null };
  tags: string[];
  assignments: WalletAssignmentRecord[];
  sync: WalletSyncRecord;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface NewWallet {
  organizationId: string;
  address: string;
  cluster: Cluster;
  label: string;
  purpose: string | null;
  category: WalletCategory;
  custodyType: CustodyType;
  notes: string | null;
  tags: string[];
  createdByUserId: string;
  createdAt: Date;
}

export interface WalletChanges {
  label?: string;
  purpose?: string | null;
  category?: WalletCategory;
  notes?: string | null;
  tags?: string[];
  status?: WalletStatus;
  archivedAt?: Date | null;
  updatedAt: Date;
}

export interface WalletListFilter {
  organizationId: string;
  cluster: Cluster;
  status: WalletStatus;
  category?: WalletCategory | undefined;
  custodyType?: CustodyType | undefined;
  tag?: string | undefined;
  search?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface WalletStore {
  countActive(organizationId: string, cluster: Cluster, transaction: Transaction): Promise<number>;
  existsByAddress(
    organizationId: string,
    address: string,
    cluster: Cluster,
    transaction: Transaction,
  ): Promise<boolean>;
  /** Inserts the wallet with its tags, the creator's `CREATOR` assignment, and an empty sync state.
   * Returns null when the address is already registered (unique constraint). */
  insert(wallet: NewWallet, transaction: Transaction): Promise<string | null>;
  list(filter: WalletListFilter): Promise<WalletRecord[]>;
  find(
    organizationId: string,
    cluster: Cluster,
    walletId: string,
    transaction?: Transaction,
  ): Promise<WalletRecord | null>;
  /** Locks the wallet row for the rest of the transaction. */
  lock(
    organizationId: string,
    cluster: Cluster,
    walletId: string,
    transaction: Transaction,
  ): Promise<boolean>;
  update(walletId: string, changes: WalletChanges, transaction: Transaction): Promise<void>;
  /** Returns false when the assignment already existed. */
  addAssignment(
    assignment: { walletId: string; userId: string; role: WalletRole; assignedByUserId: string; at: Date },
    transaction: Transaction,
  ): Promise<boolean>;
  /** Returns false when there was no such assignment. */
  removeAssignment(
    assignment: { walletId: string; userId: string; role: WalletRole },
    transaction: Transaction,
  ): Promise<boolean>;
}

export interface OwnershipChallengeStore {
  create(
    challenge: Omit<OwnershipChallenge, "id" | "consumedAt"> & { nonce: string; issuedAt: Date },
  ): Promise<string>;
  lock(challengeId: string, transaction: Transaction): Promise<OwnershipChallenge | null>;
  markConsumed(challengeId: string, at: Date, transaction: Transaction): Promise<void>;
}

export interface OrganizationMember {
  userId: string;
  displayName: string | null;
  walletAddress: string | null;
}

export interface OrganizationMemberDirectory {
  slugOf(organizationId: string): Promise<string | null>;
  listActive(organizationId: string): Promise<OrganizationMember[]>;
  isActiveMember(organizationId: string, userId: string, transaction?: Transaction): Promise<boolean>;
}

export interface WalletBalanceReader {
  read(addresses: readonly Address[], context: ReadContext): Promise<RpcReading<AddressBalance[]>>;
}

/** Short-lived cache of balance readings, keyed by the requested address set. */
export interface BalanceCache {
  get(key: string): Promise<Sourced<{ address: string; lamports: string }[]> | null>;
  set(key: string, value: Sourced<{ address: string; lamports: string }[]>, ttlMs: number): Promise<void>;
  getLastSuccess(key: string): Promise<string | null>;
  setLastSuccess(key: string, retrievedAt: string): Promise<void>;
}

export interface WalletSyncScheduler {
  /** Enqueues a sync job; a job with the same id is enqueued at most once. */
  enqueue(walletId: string, jobId: string): Promise<void>;
}

export interface IndexedTransactionRecord {
  id: string;
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  status: IndexedTransaction["status"];
  confirmationStatus: IndexedTransaction["confirmationStatus"];
  memo: string | null;
  feeLamports: bigint | null;
  solChangeLamports: bigint | null;
}

export interface IndexedTransactionStore {
  /** Newest first by slot, then id; `after` is the last row of the previous page. */
  list(
    walletId: string,
    limit: number,
    after: { slot: bigint; id: string } | null,
  ): Promise<IndexedTransactionRecord[]>;
}

/** Throttle for manual sync requests (SPEC-009 WRG-AC-14). */
export interface SyncRequestThrottle {
  /** Returns 0 when the request is accepted, or the milliseconds until the next accepted request. */
  acquire(walletId: string, windowMs: number): Promise<number>;
}
