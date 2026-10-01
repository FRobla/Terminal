import type { Logger } from "@sct/observability";
import type { NetworkIdentity, QueueState } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields, type Actor } from "../../auth/application/actor";
import type { ClusterVerificationService } from "./cluster-verification-service";
import type { ProviderProbeQueue, QueueInspector } from "./console-ports";

type QueueSection =
  | { status: "AVAILABLE"; value: QueueState; latencyMs: number }
  | { status: "UNAVAILABLE"; reason: string; source: string };

/** SPEC-026 OWN-AC-13, OWN-AC-15 — on-demand cluster verification and background job control. */
export class SystemAdministration {
  constructor(
    private readonly deps: {
      clusterVerification: ClusterVerificationService;
      rpcProviderName: string;
      queues: readonly QueueInspector[];
      audit: AuditLog;
      logger: Logger;
    },
  ) {}

  /** OWN-AC-13 */
  async verifyCluster(actor: Actor): Promise<NetworkIdentity> {
    const verified = await this.deps.clusterVerification.verify();
    await this.deps.audit.record({
      action: "system.cluster_verification_requested",
      resourceType: "cluster",
      resourceId: null,
      result: verified ? "success" : "failure",
      ...actorAuditFields(actor),
      metadata: { verified },
    });
    return this.deps.clusterVerification.identity(this.deps.rpcProviderName);
  }

  /** OWN-AC-15 */
  async queues(): Promise<QueueSection[]> {
    return Promise.all(
      this.deps.queues.map(async (queue): Promise<QueueSection> => {
        const started = performance.now();
        try {
          const value = await queue.inspect();
          return {
            status: "AVAILABLE",
            value,
            latencyMs: Math.max(0, Math.round(performance.now() - started)),
          };
        } catch (error) {
          this.deps.logger.warn({ err: error, queue: queue.queueName }, "Queue inspection failed");
          return {
            status: "UNAVAILABLE",
            reason: `Queue ${queue.queueName} could not be inspected.`,
            source: "Redis (BullMQ)",
          };
        }
      }),
    );
  }

  /** OWN-AC-15: the worker processes the job; the API only enqueues it. */
  async runProviderHealthProbe(
    actor: Actor,
    queue: ProviderProbeQueue,
  ): Promise<{ queue: string; jobId: string }> {
    const job = await queue.enqueueProbe();
    await this.deps.audit.record({
      action: "system.job_enqueued",
      resourceType: "job",
      resourceId: job.jobId,
      result: "success",
      ...actorAuditFields(actor),
      metadata: { queue: queue.queueName, jobName: job.jobName },
    });
    return { queue: queue.queueName, jobId: job.jobId };
  }
}
