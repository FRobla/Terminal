import type { Address } from "@solana/kit";
import type { AddressBalance, ReadContext, RpcReading, SimulationOutcome } from "@sct/solana";
import type { TransactionListQuery, TransactionState } from "@sct/validation";

/** SPEC-004 — what the API's transaction flows need from the chain and from storage. */

export interface TransactionChain {
  latestBlockhash(
    context: ReadContext,
  ): Promise<RpcReading<{ blockhash: string; lastValidBlockHeight: bigint; slot: bigint }>>;
  feeForMessage(messageBytes: Uint8Array, context: ReadContext): Promise<RpcReading<bigint | null>>;
  simulate(
    wireBytes: Uint8Array,
    accounts: string[],
    context: ReadContext,
  ): Promise<RpcReading<SimulationOutcome>>;
  send(wireBytes: Uint8Array): Promise<string>;
  blockHeight(): Promise<bigint>;
}

export interface BalanceReader {
  read(addresses: readonly Address[], context: ReadContext): Promise<RpcReading<AddressBalance[]>>;
}

export interface IdempotencyStore {
  find(key: {
    organizationId: string;
    userId: string;
    scope: string;
    key: string;
  }): Promise<{ requestHash: string; resourceId: string } | null>;
  /** Returns false when the key was claimed concurrently. */
  claim(
    entry: {
      organizationId: string;
      userId: string;
      scope: string;
      key: string;
      requestHash: string;
      resourceId: string;
    },
    transaction: unknown,
  ): Promise<boolean>;
}

/** Enqueues an immediate confirmation sweep after a submission (SPEC-004 amendment step 8). */
export interface ConfirmationScheduler {
  requestSweep(transactionId: string): Promise<void>;
}

export interface TransactionListing {
  id: string;
  walletLabel: string;
  initiatedBy: { id: string; displayName: string | null };
}

export interface TransactionDirectory {
  /** Ids of the organization's records on the cluster, newest first. */
  list(organizationId: string, cluster: string, query: TransactionListQuery): Promise<string[]>;
  describe(transactionId: string): Promise<TransactionListing | null>;
}

export type { TransactionState };
