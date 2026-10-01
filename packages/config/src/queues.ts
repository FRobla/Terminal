/**
 * BullMQ queue and job names (ARCHITECTURE.md §13). Shared by the worker, which owns
 * the schedules and processes jobs, and the API, which inspects queues for the owner console.
 */
export const PROVIDER_HEALTH_QUEUE = "system.provider-health";
export const PROVIDER_HEALTH_PROBE_JOB = "probe-solana-rpc";
export const PROVIDER_HEALTH_SCHEDULER_ID = "solana-rpc-probe";

/** SPEC-009 §4.8 — registered-wallet history indexing. */
export const WALLET_SYNC_QUEUE = "wallets.sync";
export const WALLET_SYNC_SWEEP_JOB = "sweep-wallets";
export const WALLET_SYNC_WALLET_JOB = "sync-wallet";
export const WALLET_SYNC_SCHEDULER_ID = "wallet-sync-sweep";

/** SPEC-004 amendment — transaction confirmation and reconciliation sweeps. */
export const TRANSACTION_CONFIRMATION_QUEUE = "transactions.confirmation";
export const TRANSACTION_CONFIRMATION_SWEEP_JOB = "sweep-confirmations";
export const TRANSACTION_CONFIRMATION_SCHEDULER_ID = "transaction-confirmation-sweep";
export const TRANSACTION_RECONCILIATION_QUEUE = "transactions.reconciliation";
export const TRANSACTION_RECONCILIATION_SWEEP_JOB = "sweep-reconciliations";
export const TRANSACTION_RECONCILIATION_SCHEDULER_ID = "transaction-reconciliation-sweep";
