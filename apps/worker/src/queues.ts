import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Logger } from "@sct/observability";
import { newRequestContext, runWithRequestContext } from "@sct/observability";
import {
  PROVIDER_HEALTH_PROBE_JOB,
  PROVIDER_HEALTH_QUEUE,
  PROVIDER_HEALTH_SCHEDULER_ID,
  TRANSACTION_CONFIRMATION_QUEUE,
  TRANSACTION_CONFIRMATION_SCHEDULER_ID,
  TRANSACTION_CONFIRMATION_SWEEP_JOB,
  TRANSACTION_RECONCILIATION_QUEUE,
  TRANSACTION_RECONCILIATION_SCHEDULER_ID,
  TRANSACTION_RECONCILIATION_SWEEP_JOB,
  WALLET_SYNC_QUEUE,
  WALLET_SYNC_SCHEDULER_ID,
  WALLET_SYNC_SWEEP_JOB,
  WALLET_SYNC_WALLET_JOB,
} from "@sct/config";
import { PROBE_INTERVAL_MS, type ProviderHealthProbe } from "./system/provider-health-probe";
import {
  CONFIRMATION_SWEEP_INTERVAL_MS,
  RECONCILIATION_SWEEP_INTERVAL_MS,
  type TransactionSweeps,
} from "./transactions/transaction-sweeps";
import { SWEEP_INTERVAL_MS, type WalletSyncJob } from "./wallets/wallet-sync-job";

/**
 * Registers queues and repeatable schedules (ARCHITECTURE.md §13). Each queue has
 * concurrency 1 where overlapping runs would double-spend the provider budget.
 */
export async function startQueues(options: {
  connection: ConnectionOptions;
  logger: Logger;
  /** The primary probe first; a fallback probe, when configured, runs in the same job. */
  providerHealthProbes: readonly ProviderHealthProbe[];
  /** Builds the wallet sync job once the queue exists (it enqueues per-wallet jobs on it). */
  walletSync: (scheduler: { enqueue(walletId: string, jobId: string): Promise<void> }) => WalletSyncJob;
  transactionSweeps: TransactionSweeps;
}) {
  const { connection, logger } = options;

  const providerHealthQueue = new Queue(PROVIDER_HEALTH_QUEUE, {
    connection,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
  });
  await providerHealthQueue.upsertJobScheduler(
    PROVIDER_HEALTH_SCHEDULER_ID,
    { every: PROBE_INTERVAL_MS },
    { name: PROVIDER_HEALTH_PROBE_JOB, data: {} },
  );

  const providerHealthWorker = new Worker(
    PROVIDER_HEALTH_QUEUE,
    async (job) =>
      runWithRequestContext(
        newRequestContext({
          requestId: `job:${job.id ?? "unknown"}`,
          feature: "system",
          operation: job.name,
        }),
        async () => {
          const results = [];
          for (const probe of options.providerHealthProbes) {
            const health = await probe.run();
            logger.info(
              { providerId: health.providerId, status: health.status },
              "Provider health probe completed",
            );
            results.push({ providerId: health.providerId, status: health.status });
          }
          return { status: results[0]?.status ?? "UNKNOWN", providers: results };
        },
      ),
    { connection, concurrency: 1 },
  );
  providerHealthWorker.on("failed", (job, error) =>
    logger.error({ err: error, jobId: job?.id, queue: PROVIDER_HEALTH_QUEUE }, "Job failed"),
  );

  // SPEC-009 §4.8 — wallet history indexing: a sweep every minute plus per-wallet jobs.
  const walletSyncQueue = new Queue(WALLET_SYNC_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 200,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
    },
  });
  await walletSyncQueue.upsertJobScheduler(
    WALLET_SYNC_SCHEDULER_ID,
    { every: SWEEP_INTERVAL_MS },
    { name: WALLET_SYNC_SWEEP_JOB, data: {}, opts: { attempts: 1 } },
  );
  const walletSync = options.walletSync({
    enqueue: async (walletId, jobId) => {
      await walletSyncQueue.add(WALLET_SYNC_WALLET_JOB, { walletId }, { jobId });
    },
  });
  const walletSyncWorker = new Worker(
    WALLET_SYNC_QUEUE,
    async (job) =>
      runWithRequestContext(
        newRequestContext({
          requestId: `job:${job.id ?? "unknown"}`,
          feature: "wallets",
          operation: job.name,
        }),
        async () => {
          if (job.name === WALLET_SYNC_SWEEP_JOB) return { enqueued: await walletSync.sweep() };
          const walletId = (job.data as { walletId?: unknown }).walletId;
          if (typeof walletId !== "string") throw new Error("Wallet sync job without a wallet id");
          return walletSync.syncWallet(walletId, { requestId: `job:${job.id ?? "unknown"}` });
        },
      ),
    // One job at a time: wallet syncs share the public Devnet budget.
    { connection, concurrency: 1 },
  );
  walletSyncWorker.on("failed", (job, error) =>
    logger.error({ err: error, jobId: job?.id, queue: WALLET_SYNC_QUEUE }, "Job failed"),
  );

  // SPEC-004 amendment — confirmation every 3 s (plus on-demand jobs after submissions), reconciliation every 10 s.
  const sweepQueueOptions = {
    connection,
    defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500, attempts: 1 },
  };
  const confirmationQueue = new Queue(TRANSACTION_CONFIRMATION_QUEUE, sweepQueueOptions);
  await confirmationQueue.upsertJobScheduler(
    TRANSACTION_CONFIRMATION_SCHEDULER_ID,
    { every: CONFIRMATION_SWEEP_INTERVAL_MS },
    { name: TRANSACTION_CONFIRMATION_SWEEP_JOB, data: {} },
  );
  const reconciliationQueue = new Queue(TRANSACTION_RECONCILIATION_QUEUE, sweepQueueOptions);
  await reconciliationQueue.upsertJobScheduler(
    TRANSACTION_RECONCILIATION_SCHEDULER_ID,
    { every: RECONCILIATION_SWEEP_INTERVAL_MS },
    { name: TRANSACTION_RECONCILIATION_SWEEP_JOB, data: {} },
  );
  const sweepWorker = (queue: string, run: (requestId: string) => Promise<unknown>) => {
    const worker = new Worker(
      queue,
      async (job) => {
        const requestId = `job:${job.id ?? "unknown"}`;
        return runWithRequestContext(
          newRequestContext({ requestId, feature: "transactions", operation: job.name }),
          () => run(requestId),
        );
      },
      // Concurrency 1: one sweep at a time per queue, so a sweep never races itself.
      { connection, concurrency: 1 },
    );
    worker.on("failed", (job, error) => logger.error({ err: error, jobId: job?.id, queue }, "Job failed"));
    return worker;
  };
  const confirmationWorker = sweepWorker(TRANSACTION_CONFIRMATION_QUEUE, () =>
    options.transactionSweeps.confirm(),
  );
  const reconciliationWorker = sweepWorker(TRANSACTION_RECONCILIATION_QUEUE, (requestId) =>
    options.transactionSweeps.reconcile({ requestId }),
  );

  return {
    /** FND-AC-09: stop taking jobs, let in-flight jobs finish (bounded by BullMQ's close), then close queues. */
    async close() {
      await Promise.all([
        providerHealthWorker.close(),
        walletSyncWorker.close(),
        confirmationWorker.close(),
        reconciliationWorker.close(),
      ]);
      await Promise.all([
        providerHealthQueue.close(),
        walletSyncQueue.close(),
        confirmationQueue.close(),
        reconciliationQueue.close(),
      ]);
    },
  };
}
