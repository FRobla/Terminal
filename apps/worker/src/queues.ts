import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Logger } from "@sct/observability";
import { newRequestContext, runWithRequestContext } from "@sct/observability";
import { PROVIDER_HEALTH_PROBE_JOB, PROVIDER_HEALTH_QUEUE, PROVIDER_HEALTH_SCHEDULER_ID } from "@sct/config";
import { PROBE_INTERVAL_MS, type ProviderHealthProbe } from "./system/provider-health-probe";

/**
 * Registers queues and repeatable schedules (ARCHITECTURE.md §13). Each queue has
 * concurrency 1 where overlapping runs would double-spend the provider budget.
 */
export async function startQueues(options: {
  connection: ConnectionOptions;
  logger: Logger;
  providerHealthProbe: ProviderHealthProbe;
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
          const health = await options.providerHealthProbe.run();
          logger.info(
            { providerId: health.providerId, status: health.status },
            "Provider health probe completed",
          );
          return { status: health.status };
        },
      ),
    { connection, concurrency: 1 },
  );
  providerHealthWorker.on("failed", (job, error) =>
    logger.error({ err: error, jobId: job?.id, queue: PROVIDER_HEALTH_QUEUE }, "Job failed"),
  );

  return {
    /** FND-AC-09: stop taking jobs, let in-flight jobs finish (bounded by BullMQ's close), then close queues. */
    async close() {
      await providerHealthWorker.close();
      await providerHealthQueue.close();
    },
  };
}
