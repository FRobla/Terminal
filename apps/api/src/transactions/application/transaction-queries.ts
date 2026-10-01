import type { PermittedCluster } from "@sct/network";
import type { TransactionRecord, TransactionStore } from "@sct/transactions";
import type { TransactionListQuery, TransactionRecordView } from "@sct/validation";
import type { OrganizationActor } from "../../wallets/application/wallet-registration";
import type { TransactionDirectory } from "./ports";
import { toTransactionView } from "./transaction-view";

/** SPEC-004 amendment — organization-scoped transaction listing and detail (`wallet.read`). */
export class TransactionQueries {
  constructor(
    private readonly config: { cluster: PermittedCluster },
    private readonly deps: { store: TransactionStore; directory: TransactionDirectory },
  ) {}

  view(record: TransactionRecord): Promise<TransactionRecordView> {
    return toTransactionView(record, this.deps);
  }

  async get(actor: OrganizationActor, transactionId: string): Promise<TransactionRecordView | null> {
    const record = await this.deps.store.find(transactionId);
    if (!record || record.organizationId !== actor.organizationId || record.cluster !== this.config.cluster) {
      return null;
    }
    return this.view(record);
  }

  async list(
    actor: OrganizationActor,
    query: TransactionListQuery,
  ): Promise<{ transactions: TransactionRecordView[]; nextCursor: string | null }> {
    const ids = await this.deps.directory.list(actor.organizationId, this.config.cluster, {
      ...query,
      limit: query.limit + 1,
    });
    const page = ids.slice(0, query.limit);
    const records = await Promise.all(page.map((id) => this.deps.store.find(id)));
    const transactions = await Promise.all(
      records
        .filter((record): record is TransactionRecord => record !== null)
        .map((record) => this.view(record)),
    );
    return { transactions, nextCursor: ids.length > query.limit ? (page.at(-1) ?? null) : null };
  }
}
