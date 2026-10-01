"use client";

import {
  AddressText,
  ConfirmAction,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  Timestamp,
  ScrollRegion,
} from "@sct/ui";
import { ApiRequestError } from "../platform/api-client";
import { describeUserAgent } from "../settings/sessions-view";
import { useAdminSessions, useRevokeAnySession } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";

/** OWN-AC-08 */
export function PlatformSessionsView() {
  const sessions = useAdminSessions();
  const revoke = useRevokeAnySession();
  const revokeError = revoke.error instanceof ApiRequestError ? revoke.error : null;

  return (
    <OwnerOnly title="Sessions">
      <Panel title={`Active sessions${sessions.data ? ` (${sessions.data.length})` : ""}`}>
        {revokeError ? <ErrorState title={revokeError.message} requestId={revokeError.requestId} /> : null}
        {sessions.isPending ? (
          <LoadingState operation="Loading active sessions…" rows={4} />
        ) : sessions.isError ? (
          <RequestFailed title="Sessions could not be loaded." error={sessions.error} />
        ) : sessions.data.length === 0 ? (
          <EmptyState>No active sessions.</EmptyState>
        ) : (
          <ScrollRegion label="Active sessions">
            <table className="w-full text-[12px]">
              <caption className="sr-only">
                Active sessions on the platform, most recently active first
              </caption>
              <thead className="text-left text-[11px] text-text-muted uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    User
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Wallet
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">
                    Client
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">
                    IP address
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Last activity
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
                    <td className="py-1 pr-3">
                      {session.user.displayName ?? (
                        <span className="font-mono text-[11px]">{session.user.id}</span>
                      )}
                      {session.current ? (
                        <span className="ml-2 text-[10px] font-semibold text-positive uppercase">
                          You, this session
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-3">
                      <AddressText value={session.walletAddress} label="Sign-in wallet" />
                    </td>
                    <td className="hidden py-1 pr-3 md:table-cell" title={session.userAgent ?? undefined}>
                      {describeUserAgent(session.userAgent)}
                    </td>
                    <td className="hidden py-1 pr-3 font-mono text-text-secondary md:table-cell">
                      {session.ipAddress ?? "—"}
                    </td>
                    <td className="py-1 pr-3 text-text-secondary">
                      <Timestamp value={session.lastSeenAt} />
                    </td>
                    <td className="hidden py-1 pr-3 text-text-secondary lg:table-cell">
                      <Timestamp value={session.expiresAt} />
                    </td>
                    <td className="py-1 text-right">
                      {session.current ? null : (
                        <ConfirmAction
                          label="Revoke"
                          consequence="That session is signed out immediately."
                          pending={revoke.isPending && revoke.variables === session.id}
                          onConfirm={() => revoke.mutate(session.id)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </Panel>
    </OwnerOnly>
  );
}
