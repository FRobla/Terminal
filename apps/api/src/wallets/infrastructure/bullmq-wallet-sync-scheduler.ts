import { WALLET_SYNC_QUEUE, WALLET_SYNC_WALLET_JOB } from "@sct/config";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { WalletSyncScheduler } from "../application/registry-ports";

/** Enqueues wallet sync jobs for the worker (SPEC-009 §4.8). The queue client is created on first use. */
export class BullmqWalletSyncScheduler implements WalletSyncScheduler {
  private queue: Queue | undefined;

  constructor(private readonly redis: Redis) {}

  async enqueue(walletId: string, jobId: string): Promise<void> {
    // A shared connection: BullMQ does not close it when the queue closes.
    this.queue ??= new Queue(WALLET_SYNC_QUEUE, { connection: this.redis });
    await this.queue.add(
      WALLET_SYNC_WALLET_JOB,
      { walletId },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }
}
