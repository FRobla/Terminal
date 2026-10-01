import type { ManagedWallet, WalletRole, WalletSyncState } from "@sct/validation";
import type { WalletRecord, WalletSyncRecord } from "./registry-ports";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function toWalletSyncState(sync: WalletSyncRecord): WalletSyncState {
  return {
    indexedCount: sync.indexedCount,
    backfillComplete: sync.backfillComplete,
    oldestIndexedBlockTime: iso(sync.oldestIndexedBlockTime),
    lastAttemptAt: iso(sync.lastAttemptAt),
    lastSuccessAt: iso(sync.lastSuccessAt),
    lastFailureAt: iso(sync.lastFailureAt),
    lastFailureReason: sync.lastFailureReason,
  };
}

/** API representation of a registered wallet, including the caller's own roles. */
export function toManagedWallet(record: WalletRecord, callerUserId: string): ManagedWallet {
  const myRoles = record.assignments
    .filter((assignment) => assignment.userId === callerUserId)
    .map((assignment) => assignment.role);
  return {
    id: record.id,
    address: record.address,
    cluster: record.cluster,
    label: record.label,
    purpose: record.purpose,
    category: record.category,
    custodyType: record.custodyType,
    notes: record.notes,
    tags: record.tags,
    status: record.status,
    createdBy: record.createdBy,
    assignments: record.assignments.map((assignment) => ({
      userId: assignment.userId,
      displayName: assignment.displayName,
      walletAddress: assignment.walletAddress,
      role: assignment.role,
      assignedAt: assignment.assignedAt.toISOString(),
    })),
    myRoles: [...new Set<WalletRole>(myRoles)],
    sync: toWalletSyncState(record.sync),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    archivedAt: iso(record.archivedAt),
  };
}
