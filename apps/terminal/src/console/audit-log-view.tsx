"use client";

import {
  Button,
  EmptyState,
  FormField,
  LoadingState,
  Panel,
  TextInput,
  Timestamp,
  ScrollRegion,
} from "@sct/ui";
import type { AuditEvent } from "@sct/validation";
import { Fragment, useState, type FormEvent } from "react";
import { useAuditEvents, type AuditFilters } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";

const EMPTY_FILTERS: AuditFilters = { action: "", actorId: "", resourceType: "", from: "", to: "" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESULT_CLASS: Record<AuditEvent["result"], string> = {
  success: "text-positive",
  failure: "text-warning",
  denied: "text-negative",
};

/** `datetime-local` value (browser time) to the API's ISO-8601 UTC format. */
function toIso(local: string): string {
  return local ? new Date(local).toISOString() : "";
}

function FilterForm(props: { onApply: (filters: AuditFilters) => void }) {
  const [draft, setDraft] = useState({ ...EMPTY_FILTERS });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof AuditFilters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.actorId && !UUID.test(draft.actorId.trim())) {
      setError("Actor must be a user ID (UUID).");
      return;
    }
    setError(null);
    props.onApply({
      action: draft.action.trim(),
      actorId: draft.actorId.trim(),
      resourceType: draft.resourceType.trim(),
      from: toIso(draft.from),
      to: toIso(draft.to),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <div className="grid gap-2 lg:grid-cols-2">
        <FormField id="audit-action" label="Action">
          <TextInput
            id="audit-action"
            placeholder="e.g. role.assigned"
            value={draft.action}
            onChange={(event) => set("action", event.target.value)}
          />
        </FormField>
        <FormField id="audit-actor" label="Actor user ID">
          <TextInput
            id="audit-actor"
            className="font-mono"
            value={draft.actorId}
            aria-invalid={error !== null}
            onChange={(event) => set("actorId", event.target.value)}
          />
        </FormField>
        <FormField id="audit-resource" label="Resource type">
          <TextInput
            id="audit-resource"
            placeholder="e.g. session, membership, route"
            value={draft.resourceType}
            onChange={(event) => set("resourceType", event.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField id="audit-from" label="From">
            <TextInput
              id="audit-from"
              type="datetime-local"
              value={draft.from}
              onChange={(event) => set("from", event.target.value)}
            />
          </FormField>
          <FormField id="audit-to" label="To">
            <TextInput
              id="audit-to"
              type="datetime-local"
              value={draft.to}
              onChange={(event) => set("to", event.target.value)}
            />
          </FormField>
        </div>
      </div>
      {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft({ ...EMPTY_FILTERS });
            setError(null);
            props.onApply({ ...EMPTY_FILTERS });
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

/** OWN-AC-09 — metadata is untrusted-shaped JSON rendered as text only. */
export function AuditLogView() {
  const [filters, setFilters] = useState<AuditFilters>({ ...EMPTY_FILTERS });
  const [expanded, setExpanded] = useState<string | null>(null);
  const events = useAuditEvents(filters);
  const rows = events.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <OwnerOnly title="Audit log">
      <Panel title="Filters">
        <FilterForm onApply={setFilters} />
      </Panel>
      <Panel title={`Events (${rows.length}${events.hasNextPage ? "+" : ""}), newest first`}>
        {events.isPending ? (
          <LoadingState operation="Reading audit events…" rows={6} />
        ) : events.isError ? (
          <RequestFailed title="Audit events could not be loaded." error={events.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No audit events match these filters.</EmptyState>
        ) : (
          <ScrollRegion label="Audit events">
            <table className="w-full text-[12px]">
              <caption className="sr-only">Audit events for the active organization</caption>
              <thead className="text-left text-[11px] text-text-muted uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Time
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Result
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">
                    Actor
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 font-medium lg:table-cell">
                    Resource
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <Fragment key={event.id}>
                    <tr className="border-b border-border/60">
                      <td className="py-1 pr-3 whitespace-nowrap text-text-secondary">
                        <Timestamp value={event.occurredAt} />
                      </td>
                      <td className="py-1 pr-3 font-mono">{event.action}</td>
                      <td
                        className={`py-1 pr-3 font-mono text-[11px] font-semibold uppercase ${RESULT_CLASS[event.result]}`}
                      >
                        {event.result}
                      </td>
                      <td className="hidden py-1 pr-3 md:table-cell">
                        <span className="text-text-secondary">{event.actorType}</span>
                        {event.actorId ? (
                          <span className="ml-1 font-mono text-[11px] text-text-muted" title={event.actorId}>
                            {event.actorId.slice(0, 8)}…
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden max-w-[260px] truncate py-1 pr-3 font-mono text-[11px] text-text-secondary lg:table-cell">
                        {event.resourceType}
                        {event.resourceId ? `:${event.resourceId}` : ""}
                      </td>
                      <td className="py-1 text-right">
                        <Button
                          variant="ghost"
                          aria-expanded={expanded === event.id}
                          onClick={() => setExpanded(expanded === event.id ? null : event.id)}
                        >
                          {expanded === event.id ? "Hide" : "Details"}
                        </Button>
                      </td>
                    </tr>
                    {expanded === event.id ? (
                      <tr className="border-b border-border bg-surface-2/50">
                        <td colSpan={6} className="px-2 py-2">
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                            <dt className="text-text-muted">Event ID</dt>
                            <dd className="font-mono break-all">{event.id}</dd>
                            <dt className="text-text-muted">Request ID</dt>
                            <dd className="font-mono break-all">{event.requestId}</dd>
                            <dt className="text-text-muted">Actor</dt>
                            <dd className="font-mono break-all">
                              {event.actorType} {event.actorId ?? ""}
                            </dd>
                            <dt className="text-text-muted">Resource</dt>
                            <dd className="font-mono break-all">
                              {event.resourceType} {event.resourceId ?? ""}
                            </dd>
                            <dt className="text-text-muted">Cluster</dt>
                            <dd className="font-mono">{event.cluster ?? "—"}</dd>
                          </dl>
                          <pre
                            tabIndex={0}
                            aria-label="Event metadata"
                            className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-panel)] border border-border bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-text-secondary"
                          >
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        {events.hasNextPage ? (
          <Button
            className="mt-2"
            onClick={() => void events.fetchNextPage()}
            disabled={events.isFetchingNextPage}
          >
            {events.isFetchingNextPage ? "Loading…" : "Load older events"}
          </Button>
        ) : null}
      </Panel>
    </OwnerOnly>
  );
}
