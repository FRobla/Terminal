"use client";

import { FreshnessLabel, LoadingState, Panel, Timestamp } from "@sct/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProviderStatusText } from "../system/provider-status";
import { useAdminOverview } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";

function Stat(props: { label: string; value: number; detail?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] tracking-wider text-text-muted uppercase">{props.label}</p>
      <p className="font-mono text-2xl tabular">{props.value.toLocaleString("en-US")}</p>
      {props.detail ? <p className="text-[11px] text-text-secondary">{props.detail}</p> : null}
    </>
  );
  const className = "block rounded-[var(--radius-panel)] border border-border bg-surface-1 px-3 py-2";
  return props.href ? (
    <Link href={props.href} className={`${className} hover:border-border-strong`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Check(props: { label: string; ok: boolean; detail?: string | undefined }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <span>{props.label}</span>
      <span className={`font-mono text-[11px] font-semibold ${props.ok ? "text-positive" : "text-negative"}`}>
        {props.ok ? "OK" : (props.detail ?? "FAILED")}
      </span>
    </li>
  );
}

/** OWN-AC-02 */
export function ConsoleOverviewView() {
  const overview = useAdminOverview();
  return (
    <OwnerOnly title="Overview">
      {overview.isPending ? (
        <LoadingState operation="Reading platform counters, readiness, and provider health…" rows={5} />
      ) : overview.isError ? (
        <RequestFailed title="The overview could not be loaded." error={overview.error} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Users"
              value={overview.data.users.total}
              detail={`${overview.data.users.active} active · ${overview.data.users.disabled} disabled`}
              href="/settings/console/members"
            />
            <Stat
              label="Members"
              value={overview.data.members.active}
              detail={`${overview.data.members.suspended} suspended`}
              href="/settings/console/members"
            />
            <Stat
              label="Active sessions"
              value={overview.data.activeSessions}
              href="/settings/console/sessions"
            />
            <Stat
              label="Audit events, 24 h"
              value={
                overview.data.audit24h.success +
                overview.data.audit24h.failure +
                overview.data.audit24h.denied
              }
              detail={
                <>
                  {overview.data.audit24h.success} success ·{" "}
                  <span className={overview.data.audit24h.failure > 0 ? "text-warning" : undefined}>
                    {overview.data.audit24h.failure} failure
                  </span>{" "}
                  ·{" "}
                  <span className={overview.data.audit24h.denied > 0 ? "text-negative" : undefined}>
                    {overview.data.audit24h.denied} denied
                  </span>
                </>
              }
              href="/settings/console/audit"
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Readiness">
              <ul className="text-[12px]">
                <Check
                  label="PostgreSQL"
                  ok={overview.data.readiness.checks.database.status === "ok"}
                  detail={overview.data.readiness.checks.database.message}
                />
                <Check
                  label="Redis"
                  ok={overview.data.readiness.checks.redis.status === "ok"}
                  detail={overview.data.readiness.checks.redis.message}
                />
                <Check
                  label="Solana cluster"
                  ok={overview.data.readiness.checks.solanaCluster.status === "ok"}
                  detail={overview.data.readiness.checks.solanaCluster.message}
                />
              </ul>
            </Panel>
            <Panel
              title="Cluster"
              actions={
                <Link href="/settings/console/system" className="text-[11px] underline">
                  Details
                </Link>
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-text-muted">Network</dt>
                <dd>{overview.data.cluster.networkLabel}</dd>
                <dt className="text-text-muted">Verified</dt>
                <dd className={overview.data.cluster.verified ? "text-positive" : "text-negative"}>
                  {overview.data.cluster.verified
                    ? "Yes"
                    : `No — ${overview.data.cluster.failureReason ?? "unknown"}`}
                </dd>
                <dt className="text-text-muted">Last check</dt>
                <dd>
                  {overview.data.cluster.checkedAt ? (
                    <FreshnessLabel retrievedAt={overview.data.cluster.checkedAt} staleAfterMs={6 * 60_000} />
                  ) : (
                    "Never"
                  )}
                </dd>
              </dl>
            </Panel>
            <Panel
              title="Providers and worker"
              actions={
                <Link href="/settings/console/jobs" className="text-[11px] underline">
                  Jobs
                </Link>
              }
            >
              <ul className="text-[12px]">
                {overview.data.providers.map((provider) => (
                  <li key={provider.providerId} className="flex justify-between gap-3 py-0.5">
                    <span>{provider.displayName}</span>
                    <ProviderStatusText status={provider.status} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-text-secondary">
                Last worker health snapshot:{" "}
                {overview.data.lastProviderSnapshotAt ? (
                  <Timestamp value={overview.data.lastProviderSnapshotAt} />
                ) : (
                  <span className="text-warning">none recorded — is the worker running?</span>
                )}
              </p>
            </Panel>
          </div>
          <p className="text-[11px] text-text-muted">
            Audit counts include the active organization and platform-level events without an organization
            (for example, failed sign-ins). Refreshes every 30 seconds.
          </p>
        </>
      )}
    </OwnerOnly>
  );
}
