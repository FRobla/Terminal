"use client";

import { AddressText, ConfirmAction, EmptyState, ErrorState, LoadingState, Panel, Timestamp } from "@sct/ui";
import { ApiRequestError } from "../platform/api-client";
import { useOwnSessions, useRevokeOwnSessions } from "./use-settings-api";

/** Readable browser summary; the full user agent stays available on hover. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown client";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${system}`;
}

/** SET-AC-07, SET-AC-08 */
export function SessionsView() {
  const sessions = useOwnSessions();
  const revoke = useRevokeOwnSessions();
  const revokeError = revoke.error instanceof ApiRequestError ? revoke.error : null;

  if (sessions.isPending) return <LoadingState operation="Loading your active sessions…" rows={3} />;
  if (sessions.isError) {
    const error = sessions.error instanceof ApiRequestError ? sessions.error : null;
    return (
      <ErrorState title="Your sessions could not be loaded." requestId={error?.requestId}>
        {error?.message}
      </ErrorState>
    );
  }
  const others = sessions.data.filter((session) => !session.current);

  return (
    <div className="space-y-3">
      <h1 className="text-[13px] font-semibold">Sessions</h1>
      <Panel
        title={`Active sessions (${sessions.data.length})`}
        actions={
          others.length > 0 ? (
            <ConfirmAction
              label="Sign out everywhere else"
              consequence={`Ends ${others.length} other session${others.length === 1 ? "" : "s"}.`}
              confirmLabel="Sign out other sessions"
              pending={revoke.isPending}
              onConfirm={() => revoke.mutate(null)}
            />
          ) : null
        }
      >
        {revokeError ? <ErrorState title={revokeError.message} requestId={revokeError.requestId} /> : null}
        <table className="w-full text-[12px]">
          <caption className="sr-only">Your active sessions, most recently active first</caption>
          <thead className="text-left text-[11px] text-text-muted uppercase">
            <tr className="border-b border-border">
              <th scope="col" className="py-1 pr-3 font-medium">
                Client
              </th>
              <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">
                IP address
              </th>
              <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">
                Wallet
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Last activity
              </th>
              <th scope="col" className="hidden py-1 pr-3 font-medium lg:table-cell">
                Signed in
              </th>
              <th scope="col" className="hidden py-1 pr-3 font-medium lg:table-cell">
                Expires
              </th>
              <th scope="col" className="py-1 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.data.map((session) => (
              <tr key={session.id} className="border-b border-border/60 last:border-0">
                <td className="py-1 pr-3" title={session.userAgent ?? undefined}>
                  {describeUserAgent(session.userAgent)}
                  {session.current ? (
                    <span className="ml-2 rounded-[var(--radius-panel)] border border-positive/50 px-1 text-[10px] font-semibold text-positive uppercase">
                      This session
                    </span>
                  ) : null}
                </td>
                <td className="hidden py-1 pr-3 font-mono text-text-secondary md:table-cell">
                  {session.ipAddress ?? "—"}
                </td>
                <td className="hidden py-1 pr-3 md:table-cell">
                  <AddressText value={session.walletAddress} label="Sign-in wallet" />
                </td>
                <td className="py-1 pr-3 text-text-secondary">
                  <Timestamp value={session.lastSeenAt} />
                </td>
                <td className="hidden py-1 pr-3 text-text-secondary lg:table-cell">
                  <Timestamp value={session.createdAt} />
                </td>
                <td className="hidden py-1 pr-3 text-text-secondary lg:table-cell">
                  <Timestamp value={session.expiresAt} />
                </td>
                <td className="py-1 text-right">
                  {session.current ? null : (
                    <ConfirmAction
                      label="Revoke"
                      consequence="That device is signed out."
                      pending={revoke.isPending && revoke.variables === session.id}
                      onConfirm={() => revoke.mutate(session.id)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {others.length === 0 ? <EmptyState>This is your only active session.</EmptyState> : null}
        <p className="mt-2 text-[11px] text-text-muted">
          Sessions end after a period without activity or when they expire. To end this session, use Sign out
          in the status bar.
        </p>
      </Panel>
    </div>
  );
}
