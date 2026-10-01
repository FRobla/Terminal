import { PROVIDER_HEALTH_PROBE_JOB, PROVIDER_HEALTH_QUEUE } from "@sct/config";
import type { QueueState } from "@sct/validation";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { QueueInspector } from "../application/console-ports";

const RECENT_JOBS = 10;
const RESULT_TEXT_LIMIT = 200;

function iso(millis: number | undefined | null): string | null {
  return typeof millis === "number" && Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function resultText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > RESULT_TEXT_LIMIT ? `${text.slice(0, RESULT_TEXT_LIMIT)}…` : text;
}

/** Reads BullMQ state for the provider-health queue (OWN-AC-15). The queue client is created on first use. */
export class BullmqProviderHealthQueue implements QueueInspector {
  readonly queueName = PROVIDER_HEALTH_QUEUE;
  private queue: Queue | undefined;

  constructor(private readonly redis: Redis) {}

  private client(): Queue {
    // A shared connection: BullMQ does not close it when the queue closes.
    this.queue ??= new Queue(this.queueName, { connection: this.redis });
    return this.queue;
  }

  async inspect(): Promise<QueueState> {
    const queue = this.client();
    const [counts, workers, schedulers, completed, failed] = await Promise.all([
      queue.getJobCounts("waiting", "prioritized", "active", "delayed", "completed", "failed"),
      queue.getWorkersCount(),
      queue.getJobSchedulers(0, 49, true),
      queue.getJobs(["completed"], 0, RECENT_JOBS - 1, false),
      queue.getJobs(["failed"], 0, RECENT_JOBS - 1, false),
    ]);
    return {
      name: this.queueName,
      workers,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        prioritized: counts.prioritized ?? 0,
      },
      schedulers: schedulers.map((scheduler) => ({
        id: scheduler.id ?? scheduler.key,
        jobName: scheduler.name,
        everyMs: scheduler.every ?? null,
        pattern: scheduler.pattern ?? null,
        nextRunAt: iso(scheduler.next),
      })),
      recentCompleted: completed.map((job) => ({
        id: job.id ?? "unknown",
        name: job.name,
        finishedAt: iso(job.finishedOn),
        durationMs:
          typeof job.finishedOn === "number" && typeof job.processedOn === "number"
            ? Math.max(0, job.finishedOn - job.processedOn)
            : null,
        result: resultText(job.returnvalue),
      })),
      recentFailed: failed.map((job) => ({
        id: job.id ?? "unknown",
        name: job.name,
        finishedAt: iso(job.finishedOn),
        failedReason: job.failedReason ? job.failedReason.slice(0, RESULT_TEXT_LIMIT) : null,
        attemptsMade: job.attemptsMade,
      })),
    };
  }

  async enqueueProbe(): Promise<{ jobId: string; jobName: string }> {
    const job = await this.client().add(
      PROVIDER_HEALTH_PROBE_JOB,
      {},
      { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
    );
    if (!job.id) throw new Error("BullMQ did not assign a job id");
    return { jobId: job.id, jobName: PROVIDER_HEALTH_PROBE_JOB };
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }
}
