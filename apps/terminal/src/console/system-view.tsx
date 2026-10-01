"use client";

import {
  AddressText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  Timestamp,
  ScrollRegion,
} from "@sct/ui";
import type { RuntimeInspection } from "@sct/validation";
import type { ReactNode } from "react";
import { useNetworkIdentity } from "../network/use-network-identity";
import { ApiRequestError } from "../platform/api-client";
import { ProviderStatusText } from "../system/provider-status";
import { useProviderHistory, useRuntimeInspection, useVerifyCluster } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";
import { formatBytes, formatDuration } from "./quantities";

function Facts(props: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
      {props.rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-text-muted">{term}</dt>
          <dd className="min-w-0 font-mono break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Unavailable(props: { section: { reason: string; source: string } }) {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-panel)] border border-warning/50 bg-warning/5 px-3 py-2 text-[12px]"
    >
      <p className="font-mono text-[11px] font-semibold tracking-wider text-warning">DATA UNAVAILABLE</p>
      <p className="mt-1">{props.section.reason}</p>
      <p className="text-text-secondary">Source: {props.section.source}. Details are in the API logs.</p>
    </div>
  );
}

function RuntimePanels(props: { runtime: RuntimeInspection }) {
  const { configuration, process, database, redis } = props.runtime;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="Configuration (non-secret)">
        <Facts
          rows={[
            ["Environment", configuration.appEnv],
            ["Cluster", configuration.cluster],
            ["Public origin", configuration.publicAppOrigin],
            ["RPC provider", configuration.rpcProvider],
            ["RPC endpoint", configuration.rpcEndpoint],
            ["Session lifetime", formatDuration(configuration.sessionTtlSeconds)],
            ["Idle timeout", formatDuration(configuration.sessionIdleTimeoutSeconds)],
            ["Bootstrap owner", configuration.bootstrapOwnerConfigured ? "Configured" : "Not configured"],
            ["Default member role", configuration.defaultMemberRole ?? "None"],
            ["OpenAPI document", configuration.openApiExposed ? "Exposed" : "Hidden (production)"],
          ]}
        />
        <p className="mt-2 text-[11px] text-text-muted">
          Secrets, credentials, and connection strings are never shown. Change configuration through the
          environment and restart the API.
        </p>
      </Panel>
      <Panel title="API process">
        <Facts
          rows={[
            ["Node.js", process.nodeVersion],
            ["Platform", `${process.platform} ${process.arch}`],
            ["PID", process.pid],
            ["Started", <Timestamp key="started" value={process.startedAt} />],
            ["Uptime", formatDuration(process.uptimeSeconds)],
            ["Resident memory", formatBytes(process.rssBytes)],
            ["Heap", `${formatBytes(process.heapUsedBytes)} of ${formatBytes(process.heapTotalBytes)}`],
          ]}
        />
      </Panel>
      <Panel
        title="PostgreSQL"
        footer={database.status === "AVAILABLE" ? `Inspected in ${database.latencyMs} ms` : undefined}
      >
        {database.status === "UNAVAILABLE" ? (
          <Unavailable section={database} />
        ) : (
          <>
            <Facts
              rows={[
                ["Server version", database.value.serverVersion],
                ["Database size", formatBytes(database.value.databaseSizeBytes)],
                [
                  "Migrations",
                  `${database.value.migrations.applied} applied of ${database.value.migrations.committed} committed`,
                ],
                ["Latest applied", database.value.migrations.latestAppliedTag ?? "None"],
              ]}
            />
            {database.value.migrations.pending.length > 0 ? (
              <ErrorState title="Pending migrations">
                {database.value.migrations.pending.join(", ")} — run <code>pnpm db:migrate</code>.
              </ErrorState>
            ) : null}
            <table className="mt-3 w-full text-[12px]">
              <caption className="sr-only">Table statistics</caption>
              <thead className="text-left text-[11px] text-text-muted uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Table
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    Rows (estimate)
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {database.value.tables.map((table) => (
                  <tr key={table.name} className="border-b border-border/60 last:border-0">
                    <td className="py-0.5 pr-3 font-mono">{table.name}</td>
                    <td className="py-0.5 pr-3 text-right font-mono tabular">
                      {table.liveRows.toLocaleString("en-US")}
                    </td>
                    <td className="py-0.5 text-right font-mono tabular">{formatBytes(table.totalBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>
      <Panel
        title="Redis"
        footer={redis.status === "AVAILABLE" ? `Inspected in ${redis.latencyMs} ms` : undefined}
      >
        {redis.status === "UNAVAILABLE" ? (
          <Unavailable section={redis} />
        ) : (
          <Facts
            rows={[
              ["Version", redis.value.version],
              ["Mode", redis.value.mode],
              ["Uptime", formatDuration(redis.value.uptimeSeconds)],
              ["Memory used", formatBytes(redis.value.usedMemoryBytes)],
              ["Connected clients", redis.value.connectedClients],
              ["Keys (this database)", redis.value.keyCount.toLocaleString("en-US")],
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

function ClusterPanel() {
  const network = useNetworkIdentity();
  const verify = useVerifyCluster();
  const identity = verify.data ?? network.identity;
  const error = verify.error instanceof ApiRequestError ? verify.error : null;
  return (
    <Panel
      title="Solana cluster"
      actions={
        <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? "Verifying…" : "Verify now"}
        </Button>
      }
    >
      {error ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
      {!identity ? (
        <LoadingState operation="Reading cluster identity…" rows={3} />
      ) : (
        <Facts
          rows={[
            ["Network", identity.networkLabel],
            [
              "Verified",
              <span key="verified" className={identity.verified ? "text-positive" : "text-negative"}>
                {identity.verified
                  ? "Yes — genesis hash matches"
                  : `No — ${identity.failureReason ?? "unknown"}`}
              </span>,
            ],
            [
              "Observed genesis",
              identity.observedGenesisHash ? (
                <AddressText
                  key="genesis"
                  value={identity.observedGenesisHash}
                  full
                  label="Observed genesis hash"
                />
              ) : (
                "Not observed"
              ),
            ],
            ["solana-core", identity.solanaCoreVersion ?? "Unknown"],
            [
              "Checked",
              identity.checkedAt ? <Timestamp key="checked" value={identity.checkedAt} /> : "Never",
            ],
          ]}
        />
      )}
      <p className="mt-2 text-[11px] text-text-muted">
        Verification calls the RPC (getGenesisHash, getVersion) and is limited to 6 requests per minute.
      </p>
    </Panel>
  );
}

function ProviderHistoryPanel() {
  const history = useProviderHistory(60);
  return (
    <Panel title="Provider health history (worker snapshots)">
      {history.isPending ? (
        <LoadingState operation="Reading provider health snapshots…" rows={4} />
      ) : history.isError ? (
        <RequestFailed title="Provider history could not be loaded." error={history.error} />
      ) : history.data.length === 0 ? (
        <EmptyState>No snapshots yet. The worker records one per minute while it runs.</EmptyState>
      ) : (
        <ScrollRegion label="Provider health snapshots" className="max-h-96 overflow-auto">
          <table className="w-full text-[12px]">
            <caption className="sr-only">Provider health snapshots, newest first</caption>
            <thead className="sticky top-0 bg-surface-1 text-left text-[11px] text-text-muted uppercase">
              <tr className="border-b border-border">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Checked
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Provider
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Status
                </th>
                <th scope="col" className="hidden py-1 pr-3 text-right font-medium md:table-cell">
                  p50 / p95
                </th>
                <th scope="col" className="hidden py-1 pr-3 text-right font-medium md:table-cell">
                  Errors
                </th>
                <th scope="col" className="hidden py-1 pr-3 text-right font-medium lg:table-cell">
                  Requests
                </th>
                <th scope="col" className="hidden py-1 font-medium lg:table-cell">
                  Last failure
                </th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((snapshot) => (
                <tr key={snapshot.id} className="border-b border-border/60 last:border-0">
                  <td className="py-0.5 pr-3 whitespace-nowrap text-text-secondary">
                    <Timestamp value={snapshot.checkedAt} />
                  </td>
                  <td className="py-0.5 pr-3 font-mono">{snapshot.providerId}</td>
                  <td className="py-0.5 pr-3">
                    <ProviderStatusText status={snapshot.status} />
                  </td>
                  <td className="hidden py-0.5 pr-3 text-right font-mono tabular md:table-cell">
                    {snapshot.latencyP50Ms ?? "—"} / {snapshot.latencyP95Ms ?? "—"} ms
                  </td>
                  <td className="hidden py-0.5 pr-3 text-right font-mono tabular md:table-cell">
                    {snapshot.errorRate === null ? "—" : `${(snapshot.errorRate * 100).toFixed(1)}%`}
                  </td>
                  <td className="hidden py-0.5 pr-3 text-right font-mono tabular lg:table-cell">
                    {snapshot.requestCount}
                  </td>
                  <td className="hidden py-0.5 text-text-secondary lg:table-cell">
                    {snapshot.lastFailureReason ?? "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Panel>
  );
}

/** OWN-AC-12, OWN-AC-13, OWN-AC-14 */
export function ConsoleSystemView() {
  const runtime = useRuntimeInspection();
  return (
    <OwnerOnly title="System">
      {runtime.isPending ? (
        <LoadingState operation="Inspecting the API process, PostgreSQL, and Redis…" rows={6} />
      ) : runtime.isError ? (
        <RequestFailed title="Runtime inspection failed." error={runtime.error} />
      ) : (
        <RuntimePanels runtime={runtime.data} />
      )}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ClusterPanel />
        <ProviderHistoryPanel />
      </div>
    </OwnerOnly>
  );
}
