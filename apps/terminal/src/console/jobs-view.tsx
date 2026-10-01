"use client";

import { Button, EmptyState, ErrorState, LoadingState, Panel, Timestamp } from "@sct/ui";
import { JOB_STATE_COUNTERS, type QueueState } from "@sct/validation";
import { ApiRequestError } from "../platform/api-client";
import { useJobs, useRunProviderProbe } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";
import { formatDuration } from "./quantities";

function QueuePanel(props: { queue: QueueState }) {
  const { queue } = props;
  const run = useRunProviderProbe();
  const error = run.error instanceof ApiRequestError ? run.error : null;
  return (
    <Panel
      title={`Queue ${queue.name}`}
      actions={
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? "Enqueuing…" : "Run probe now"}
        </Button>
      }
    >
      {error ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
      {run.isSuccess ? (
        <p role="status" className="mb-2 text-[11px] text-positive">
          Enqueued job {run.data.jobId}. The worker processes it within seconds while it runs.
        </p>
      ) : null}
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        <div className="rounded-[var(--radius-panel)] border border-border px-2 py-1">
          <dt className="text-[10px] text-text-muted uppercase">Workers</dt>
          <dd className={`font-mono text-lg tabular ${queue.workers === 0 ? "text-negative" : ""}`}>
            {queue.workers}
          </dd>
        </div>
        {JOB_STATE_COUNTERS.map((state) => (
          <div key={state} className="rounded-[var(--radius-panel)] border border-border px-2 py-1">
            <dt className="text-[10px] text-text-muted uppercase">{state}</dt>
            <dd
              className={`font-mono text-lg tabular ${state === "failed" && queue.counts[state] > 0 ? "text-warning" : ""}`}
            >
              {queue.counts[state]}
            </dd>
          </div>
        ))}
      </dl>
      {queue.workers === 0 ? (
        <p className="mt-2 text-[11px] text-negative">
          No worker is connected to this queue. Start it with pnpm dev.
        </p>
      ) : null}

      <h3 className="mt-3 mb-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
        Schedulers
      </h3>
      {queue.schedulers.length === 0 ? (
        <EmptyState>No schedulers registered. The worker registers them on start.</EmptyState>
      ) : (
        <ul className="text-[12px]">
          {queue.schedulers.map((scheduler) => (
            <li
              key={scheduler.id}
              className="flex flex-wrap gap-x-3 border-b border-border/60 py-0.5 last:border-0"
            >
              <span className="font-mono">{scheduler.id}</span>
              <span className="text-text-secondary">job {scheduler.jobName}</span>
              <span className="text-text-secondary">
                {scheduler.everyMs !== null
                  ? `every ${formatDuration(scheduler.everyMs / 1000)}`
                  : (scheduler.pattern ?? "")}
              </span>
              <span className="text-text-secondary">
                next {scheduler.nextRunAt ? <Timestamp value={scheduler.nextRunAt} /> : "unknown"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Recently completed
          </h3>
          {queue.recentCompleted.length === 0 ? (
            <EmptyState>No completed jobs retained.</EmptyState>
          ) : (
            <ul className="text-[12px]">
              {queue.recentCompleted.map((job) => (
                <li key={job.id} className="border-b border-border/60 py-0.5 last:border-0">
                  <span className="font-mono text-text-secondary">#{job.id}</span>{" "}
                  {job.finishedAt ? <Timestamp value={job.finishedAt} /> : "—"}
                  {job.durationMs !== null ? (
                    <span className="text-text-muted"> · {job.durationMs} ms</span>
                  ) : null}
                  {job.result ? (
                    <span className="ml-1 font-mono text-[11px] text-text-secondary">{job.result}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Recently failed
          </h3>
          {queue.recentFailed.length === 0 ? (
            <EmptyState>No failed jobs retained.</EmptyState>
          ) : (
            <ul className="text-[12px]">
              {queue.recentFailed.map((job) => (
                <li key={job.id} className="border-b border-border/60 py-0.5 last:border-0">
                  <span className="font-mono text-text-secondary">#{job.id}</span>{" "}
                  {job.finishedAt ? <Timestamp value={job.finishedAt} /> : "—"}
                  <span className="block text-negative">{job.failedReason ?? "No reason recorded"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** OWN-AC-15 */
export function JobsView() {
  const jobs = useJobs();
  return (
    <OwnerOnly title="Jobs">
      {jobs.isPending ? (
        <LoadingState operation="Reading BullMQ queues from Redis…" rows={4} />
      ) : jobs.isError ? (
        <RequestFailed title="Queues could not be loaded." error={jobs.error} />
      ) : (
        jobs.data.queues.map((queue, index) =>
          queue.status === "AVAILABLE" ? (
            <QueuePanel key={queue.value.name} queue={queue.value} />
          ) : (
            <div
              key={index}
              role="status"
              className="rounded-[var(--radius-panel)] border border-warning/50 bg-warning/5 px-3 py-2 text-[12px]"
            >
              <p className="font-mono text-[11px] font-semibold tracking-wider text-warning">
                DATA UNAVAILABLE
              </p>
              <p className="mt-1">{queue.reason}</p>
              <p className="text-text-secondary">Source: {queue.source}</p>
            </div>
          ),
        )
      )}
      <p className="text-[11px] text-text-muted">Refreshes every 15 seconds.</p>
    </OwnerOnly>
  );
}
