import type { Cluster } from "@sct/network";
import { and, count, desc, eq, ilike, inArray, lt, or, schema, sql, type Database } from "@sct/database";
import type { CustodyType, WalletCategory, WalletRole, WalletStatus } from "@sct/validation";
import type { Transaction } from "../../auth/application/ports";
import type {
  NewWallet,
  WalletAssignmentRecord,
  WalletChanges,
  WalletListFilter,
  WalletRecord,
  WalletStore,
  WalletSyncRecord,
} from "../application/registry-ports";

type WalletRow = typeof schema.managedWallets.$inferSelect & { createdByName: string | null };

/** Escapes LIKE wildcards in user input. */
function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export class WalletRepository implements WalletStore {
  constructor(private readonly db: Database) {}

  private executor(transaction?: Transaction): Database {
    return (transaction as Database | undefined) ?? this.db;
  }

  async countActive(organizationId: string, cluster: Cluster, transaction: Transaction): Promise<number> {
    const [row] = await this.executor(transaction)
      .select({ value: count() })
      .from(schema.managedWallets)
      .where(
        and(
          eq(schema.managedWallets.organizationId, organizationId),
          eq(schema.managedWallets.cluster, cluster),
          eq(schema.managedWallets.status, "active"),
        ),
      );
    return row?.value ?? 0;
  }

  async existsByAddress(
    organizationId: string,
    address: string,
    cluster: Cluster,
    transaction: Transaction,
  ): Promise<boolean> {
    const [row] = await this.executor(transaction)
      .select({ id: schema.managedWallets.id })
      .from(schema.managedWallets)
      .where(
        and(
          eq(schema.managedWallets.organizationId, organizationId),
          eq(schema.managedWallets.address, address),
          eq(schema.managedWallets.cluster, cluster),
        ),
      );
    return row !== undefined;
  }

  async insert(wallet: NewWallet, transaction: Transaction): Promise<string | null> {
    const tx = this.executor(transaction);
    const [row] = await tx
      .insert(schema.managedWallets)
      .values({
        organizationId: wallet.organizationId,
        address: wallet.address,
        cluster: wallet.cluster,
        label: wallet.label,
        purpose: wallet.purpose,
        category: wallet.category,
        custodyType: wallet.custodyType,
        notes: wallet.notes,
        createdByUserId: wallet.createdByUserId,
        createdAt: wallet.createdAt,
        updatedAt: wallet.createdAt,
      })
      .onConflictDoNothing({
        target: [
          schema.managedWallets.organizationId,
          schema.managedWallets.address,
          schema.managedWallets.cluster,
        ],
      })
      .returning({ id: schema.managedWallets.id });
    if (!row) return null;
    if (wallet.tags.length > 0) {
      await tx.insert(schema.walletTags).values(wallet.tags.map((tag) => ({ walletId: row.id, tag })));
    }
    await tx.insert(schema.walletAssignments).values({
      walletId: row.id,
      userId: wallet.createdByUserId,
      role: "CREATOR",
      assignedByUserId: wallet.createdByUserId,
      createdAt: wallet.createdAt,
    });
    await tx.insert(schema.walletSyncState).values({ walletId: row.id });
    return row.id;
  }

  async list(filter: WalletListFilter): Promise<WalletRecord[]> {
    const conditions = [
      eq(schema.managedWallets.organizationId, filter.organizationId),
      eq(schema.managedWallets.cluster, filter.cluster),
      eq(schema.managedWallets.status, filter.status),
    ];
    if (filter.category) conditions.push(eq(schema.managedWallets.category, filter.category));
    if (filter.custodyType) conditions.push(eq(schema.managedWallets.custodyType, filter.custodyType));
    if (filter.cursor) conditions.push(lt(schema.managedWallets.id, filter.cursor));
    if (filter.tag) {
      conditions.push(
        inArray(
          schema.managedWallets.id,
          this.db
            .select({ walletId: schema.walletTags.walletId })
            .from(schema.walletTags)
            .where(eq(schema.walletTags.tag, filter.tag)),
        ),
      );
    }
    if (filter.search) {
      const pattern = likePrefix(filter.search);
      const search = or(
        ilike(schema.managedWallets.label, `%${pattern}`),
        sql`${schema.managedWallets.address} like ${pattern}`,
      );
      if (search) conditions.push(search);
    }
    const rows = await this.selectWallets(this.db)
      .where(and(...conditions))
      .orderBy(desc(schema.managedWallets.id))
      .limit(filter.limit);
    return this.enrich(rows, this.db);
  }

  async find(
    organizationId: string,
    cluster: Cluster,
    walletId: string,
    transaction?: Transaction,
  ): Promise<WalletRecord | null> {
    const db = this.executor(transaction);
    const rows = await this.selectWallets(db).where(
      and(
        eq(schema.managedWallets.id, walletId),
        eq(schema.managedWallets.organizationId, organizationId),
        eq(schema.managedWallets.cluster, cluster),
      ),
    );
    const [record] = await this.enrich(rows, db);
    return record ?? null;
  }

  async lock(
    organizationId: string,
    cluster: Cluster,
    walletId: string,
    transaction: Transaction,
  ): Promise<boolean> {
    const [row] = await this.executor(transaction)
      .select({ id: schema.managedWallets.id })
      .from(schema.managedWallets)
      .where(
        and(
          eq(schema.managedWallets.id, walletId),
          eq(schema.managedWallets.organizationId, organizationId),
          eq(schema.managedWallets.cluster, cluster),
        ),
      )
      .for("update");
    return row !== undefined;
  }

  async update(walletId: string, changes: WalletChanges, transaction: Transaction): Promise<void> {
    const tx = this.executor(transaction);
    const { tags, ...columns } = changes;
    await tx.update(schema.managedWallets).set(columns).where(eq(schema.managedWallets.id, walletId));
    if (tags) {
      await tx.delete(schema.walletTags).where(eq(schema.walletTags.walletId, walletId));
      if (tags.length > 0) {
        await tx.insert(schema.walletTags).values(tags.map((tag) => ({ walletId, tag })));
      }
    }
  }

  async addAssignment(
    assignment: { walletId: string; userId: string; role: WalletRole; assignedByUserId: string; at: Date },
    transaction: Transaction,
  ): Promise<boolean> {
    const rows = await this.executor(transaction)
      .insert(schema.walletAssignments)
      .values({
        walletId: assignment.walletId,
        userId: assignment.userId,
        role: assignment.role,
        assignedByUserId: assignment.assignedByUserId,
        createdAt: assignment.at,
      })
      .onConflictDoNothing()
      .returning({ walletId: schema.walletAssignments.walletId });
    return rows.length > 0;
  }

  async removeAssignment(
    assignment: { walletId: string; userId: string; role: WalletRole },
    transaction: Transaction,
  ): Promise<boolean> {
    const rows = await this.executor(transaction)
      .delete(schema.walletAssignments)
      .where(
        and(
          eq(schema.walletAssignments.walletId, assignment.walletId),
          eq(schema.walletAssignments.userId, assignment.userId),
          eq(schema.walletAssignments.role, assignment.role),
        ),
      )
      .returning({ walletId: schema.walletAssignments.walletId });
    return rows.length > 0;
  }

  private selectWallets(db: Database) {
    return db
      .select({
        id: schema.managedWallets.id,
        organizationId: schema.managedWallets.organizationId,
        address: schema.managedWallets.address,
        cluster: schema.managedWallets.cluster,
        label: schema.managedWallets.label,
        purpose: schema.managedWallets.purpose,
        category: schema.managedWallets.category,
        custodyType: schema.managedWallets.custodyType,
        notes: schema.managedWallets.notes,
        status: schema.managedWallets.status,
        createdByUserId: schema.managedWallets.createdByUserId,
        archivedAt: schema.managedWallets.archivedAt,
        createdAt: schema.managedWallets.createdAt,
        updatedAt: schema.managedWallets.updatedAt,
        createdByName: schema.users.displayName,
      })
      .from(schema.managedWallets)
      .innerJoin(schema.users, eq(schema.users.id, schema.managedWallets.createdByUserId))
      .$dynamic();
  }

  private async enrich(rows: WalletRow[], db: Database): Promise<WalletRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [tags, assignments, syncStates] = await Promise.all([
      db
        .select({ walletId: schema.walletTags.walletId, tag: schema.walletTags.tag })
        .from(schema.walletTags)
        .where(inArray(schema.walletTags.walletId, ids))
        .orderBy(schema.walletTags.tag),
      db
        .select({
          walletId: schema.walletAssignments.walletId,
          userId: schema.walletAssignments.userId,
          role: schema.walletAssignments.role,
          assignedAt: schema.walletAssignments.createdAt,
          displayName: schema.users.displayName,
          walletAddress: sql<string | null>`(
            select ${schema.userWalletIdentities.address} from ${schema.userWalletIdentities}
            where ${schema.userWalletIdentities.userId} = ${schema.walletAssignments.userId}
            order by ${schema.userWalletIdentities.lastSeenAt} desc limit 1
          )`,
        })
        .from(schema.walletAssignments)
        .innerJoin(schema.users, eq(schema.users.id, schema.walletAssignments.userId))
        .where(inArray(schema.walletAssignments.walletId, ids))
        .orderBy(schema.walletAssignments.createdAt),
      db
        .select({
          walletId: schema.walletSyncState.walletId,
          newestSignature: schema.walletSyncState.newestSignature,
          oldestSignature: schema.walletSyncState.oldestSignature,
          backfillComplete: schema.walletSyncState.backfillComplete,
          indexedCount: schema.walletSyncState.indexedCount,
          lastAttemptAt: schema.walletSyncState.lastAttemptAt,
          lastSuccessAt: schema.walletSyncState.lastSuccessAt,
          lastFailureAt: schema.walletSyncState.lastFailureAt,
          lastFailureReason: schema.walletSyncState.lastFailureReason,
          oldestIndexedBlockTime: sql<string | null>`(
            select min(${schema.indexedTransactions.blockTime}) from ${schema.indexedTransactions}
            where ${schema.indexedTransactions.walletId} = ${schema.walletSyncState.walletId}
          )`,
        })
        .from(schema.walletSyncState)
        .where(inArray(schema.walletSyncState.walletId, ids)),
    ]);

    const tagsByWallet = group(tags, (row) => row.walletId);
    const assignmentsByWallet = group(assignments, (row) => row.walletId);
    const syncByWallet = new Map(syncStates.map((row) => [row.walletId, row]));

    return rows.map((row) => {
      const sync = syncByWallet.get(row.id);
      return {
        id: row.id,
        organizationId: row.organizationId,
        address: row.address,
        cluster: row.cluster,
        label: row.label,
        purpose: row.purpose,
        category: row.category as WalletCategory,
        custodyType: row.custodyType as CustodyType,
        notes: row.notes,
        status: row.status as WalletStatus,
        createdBy: { id: row.createdByUserId, displayName: row.createdByName },
        tags: (tagsByWallet.get(row.id) ?? []).map((tag) => tag.tag),
        assignments: (assignmentsByWallet.get(row.id) ?? []).map((assignment): WalletAssignmentRecord => ({
          userId: assignment.userId,
          displayName: assignment.displayName,
          walletAddress: assignment.walletAddress,
          role: assignment.role as WalletRole,
          assignedAt: assignment.assignedAt,
        })),
        sync: toSyncRecord(sync),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      };
    });
  }
}

function toSyncRecord(
  row:
    | {
        newestSignature: string | null;
        oldestSignature: string | null;
        backfillComplete: boolean;
        indexedCount: number;
        lastAttemptAt: Date | null;
        lastSuccessAt: Date | null;
        lastFailureAt: Date | null;
        lastFailureReason: string | null;
        oldestIndexedBlockTime: string | null;
      }
    | undefined,
): WalletSyncRecord {
  return {
    newestSignature: row?.newestSignature ?? null,
    oldestSignature: row?.oldestSignature ?? null,
    oldestIndexedBlockTime: row?.oldestIndexedBlockTime ? new Date(row.oldestIndexedBlockTime) : null,
    backfillComplete: row?.backfillComplete ?? false,
    indexedCount: row?.indexedCount ?? 0,
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastFailureAt: row?.lastFailureAt ?? null,
    lastFailureReason: row?.lastFailureReason ?? null,
  };
}

function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}
