"use client";

import type { Provenance } from "@sct/validation";
import { Popover } from "radix-ui";
import { useDisplaySettings } from "./display-settings";
import { describeFreshness } from "./freshness";
import { formatTimestamp } from "./timestamp";
import { useNow } from "./use-now";

/** WO-AC-07 — freshness label with the stale state in the warning color. */
export function FreshnessLabel(props: { retrievedAt: string; staleAfterMs: number }) {
  const now = useNow();
  const freshness = describeFreshness(props.retrievedAt, now, props.staleAfterMs);
  return (
    <time
      dateTime={props.retrievedAt}
      title={new Date(props.retrievedAt).toISOString()}
      className={`text-[11px] ${freshness.state === "stale" ? "font-medium text-warning" : "text-text-muted"}`}
    >
      {freshness.label}
    </time>
  );
}

/** WO-AC-06 — provenance details, keyboard accessible. */
export function ProvenanceDetails(props: { provenance: Provenance; label: string }) {
  const p = props.provenance;
  const { timeZone } = useDisplaySettings();
  const rows: Array<[string, string]> = [
    ["Source", p.source],
    ["Provider", p.provider],
    ["Endpoint", p.endpoint],
    ["Method", p.method ?? "—"],
    ["Network", p.network],
    ["Commitment", p.commitment ?? "—"],
    ["Context slot", p.slot ?? "—"],
    ["Retrieved at", `${formatTimestamp(p.retrievedAt, timeZone)} (${p.retrievedAt})`],
    ["Latency", p.latencyMs !== undefined ? `${p.latencyMs} ms` : "—"],
    ["Confidence", p.confidence],
    ["Fallback used", p.fallbackUsed ? "Yes" : "No"],
    ["Data version", p.dataVersion],
    ["Request ID", p.requestId],
  ];
  return (
    <Popover.Root>
      <Popover.Trigger
        className="rounded-[var(--radius-panel)] border border-border px-1.5 text-[11px] text-text-secondary hover:text-text-primary"
        aria-label={`Show data source for ${props.label}`}
      >
        Source
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="end"
          className="z-50 w-[360px] max-w-[calc(100vw-32px)] rounded-[var(--radius-panel)] border border-border-strong bg-surface-2 p-3 text-[12px] shadow-lg"
        >
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-text-secondary uppercase">
            Provenance — {props.label}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {rows.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-text-muted">{term}</dt>
                <dd className="font-mono break-all text-text-primary">{value}</dd>
              </div>
            ))}
          </dl>
          <Popover.Arrow className="fill-border-strong" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
