"use client";

import type { Sourced } from "@sct/validation";
import { DataUnavailable, FreshnessLabel, LoadingState, Panel, ProvenanceDetails } from "@sct/ui";
import type { ReactNode } from "react";

export const OVERVIEW_STALE_AFTER_MS = 60_000;

/**
 * Renders one Sourced<T> section with its loading, unavailable, stale, and
 * available states (SPEC-003 §4). Values are never rendered without provenance.
 */
export function SourcedPanel<T>(props: {
  title: string;
  sourced: Sourced<T> | undefined;
  loadingOperation: string;
  onRetry: () => void;
  retrying: boolean;
  children: (value: T) => ReactNode;
}) {
  const { sourced } = props;
  const available = sourced && sourced.status !== "UNAVAILABLE" ? sourced : null;
  return (
    <Panel
      title={props.title}
      aria-busy={sourced === undefined}
      actions={available ? <ProvenanceDetails provenance={available.provenance} label={props.title} /> : null}
      footer={
        available ? (
          <span className="flex flex-wrap items-center gap-x-3">
            <FreshnessLabel
              retrievedAt={available.provenance.retrievedAt}
              staleAfterMs={OVERVIEW_STALE_AFTER_MS}
            />
            <span>
              {available.provenance.network} · {available.provenance.commitment ?? "—"}
              {available.provenance.slot ? ` · slot ${available.provenance.slot}` : ""}
            </span>
          </span>
        ) : undefined
      }
    >
      {sourced === undefined ? (
        <LoadingState operation={props.loadingOperation} />
      ) : sourced.status === "UNAVAILABLE" ? (
        <DataUnavailable info={sourced.unavailable} onRetry={props.onRetry} retrying={props.retrying} />
      ) : (
        props.children(sourced.value)
      )}
    </Panel>
  );
}
