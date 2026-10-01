"use client";

import {
  AddressText,
  Button,
  ConfirmAction,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  Select,
  Timestamp,
  ScrollRegion,
} from "@sct/ui";
import { ASSIGNABLE_ROLE_KEYS, SYSTEM_ROLES, type AdminUser, type AssignableRoleKey } from "@sct/validation";
import { Fragment, useState } from "react";
import { ApiRequestError } from "../platform/api-client";
import { useAdminUsers, useMemberAction } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";

const PROTECTION_TEXT = {
  SELF: "This is your account. Manage your own access from Profile and Sessions.",
  OWNER_PROTECTED: "Owner accounts cannot be changed from the console.",
} as const;

function MemberActions(props: { user: AdminUser }) {
  const { user } = props;
  const action = useMemberAction();
  const currentRole = user.membership?.roles.find((role): role is { key: AssignableRoleKey; name: string } =>
    (ASSIGNABLE_ROLE_KEYS as readonly string[]).includes(role.key),
  )?.key;
  const [roleKey, setRoleKey] = useState<AssignableRoleKey>(currentRole ?? "viewer");
  const error = action.error instanceof ApiRequestError ? action.error : null;

  if (user.protectedReason) {
    return <p className="text-[12px] text-text-secondary">{PROTECTION_TEXT[user.protectedReason]}</p>;
  }

  const suspended = user.membership?.status === "suspended";
  const disabled = user.status === "disabled";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`role-${user.id}`} className="text-[12px] text-text-secondary">
          Role in organization
        </label>
        <Select
          id={`role-${user.id}`}
          className="!w-auto"
          value={roleKey}
          onChange={(event) => setRoleKey(event.target.value as AssignableRoleKey)}
        >
          {ASSIGNABLE_ROLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {SYSTEM_ROLES[key].name}
            </option>
          ))}
        </Select>
        <ConfirmAction
          variant="default"
          label={user.membership ? "Set role" : "Add to organization"}
          consequence={`Replaces all roles with ${SYSTEM_ROLES[roleKey].name}${suspended ? " and reactivates the membership" : ""}.`}
          confirmLabel="Apply role"
          pending={action.isPending && action.variables?.kind === "role"}
          disabled={roleKey === currentRole && !suspended}
          onConfirm={() => action.mutate({ kind: "role", userId: user.id, roleKey })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {user.membership ? (
          suspended ? (
            <Button
              onClick={() => action.mutate({ kind: "membership", userId: user.id, status: "active" })}
              disabled={action.isPending}
            >
              Reactivate membership
            </Button>
          ) : (
            <ConfirmAction
              label="Suspend membership"
              consequence="Removes every organization permission until reactivated."
              pending={action.isPending && action.variables?.kind === "membership"}
              onConfirm={() => action.mutate({ kind: "membership", userId: user.id, status: "suspended" })}
            />
          )
        ) : null}
        {disabled ? (
          <Button
            onClick={() => action.mutate({ kind: "status", userId: user.id, status: "active" })}
            disabled={action.isPending}
          >
            Enable account
          </Button>
        ) : (
          <ConfirmAction
            label="Disable account"
            consequence="Signs the user out everywhere and blocks new sign-ins."
            pending={action.isPending && action.variables?.kind === "status"}
            onConfirm={() => action.mutate({ kind: "status", userId: user.id, status: "disabled" })}
          />
        )}
        {user.activeSessionCount > 0 ? (
          <ConfirmAction
            label="Revoke sessions"
            consequence={`Signs out ${user.activeSessionCount} active session${user.activeSessionCount === 1 ? "" : "s"}.`}
            pending={action.isPending && action.variables?.kind === "revoke-sessions"}
            onConfirm={() => action.mutate({ kind: "revoke-sessions", userId: user.id })}
          />
        ) : null}
      </div>
      {error ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
      {action.isSuccess ? (
        <p role="status" className="text-[11px] text-positive">
          Saved. The change applies on the user&apos;s next request.
        </p>
      ) : null}
    </div>
  );
}

function MembershipCell(props: { user: AdminUser }) {
  const membership = props.user.membership;
  if (!membership) return <span className="text-text-muted">Not a member</span>;
  return (
    <span>
      {membership.roles.length > 0 ? membership.roles.map((role) => role.name).join(", ") : "No role"}
      {membership.status === "suspended" ? <span className="ml-1 text-warning">· suspended</span> : null}
    </span>
  );
}

/** OWN-AC-03 … OWN-AC-07 */
export function MembersView() {
  const users = useAdminUsers();
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = users.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <OwnerOnly title="Members">
      <Panel title={`Users (${rows.length}${users.hasNextPage ? "+" : ""})`}>
        {users.isPending ? (
          <LoadingState operation="Loading users, memberships, and sessions…" rows={5} />
        ) : users.isError ? (
          <RequestFailed title="Users could not be loaded." error={users.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No users have signed in yet.</EmptyState>
        ) : (
          <ScrollRegion label="Users">
            <table className="w-full text-[12px]">
              <caption className="sr-only">Every user on the platform with organization access</caption>
              <thead className="text-left text-[11px] text-text-muted uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    User
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Sign-in wallet
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Access
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">
                    Account
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 text-right font-medium md:table-cell">
                    Sessions
                  </th>
                  <th scope="col" className="hidden py-1 pr-3 font-medium lg:table-cell">
                    Last activity
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <Fragment key={user.id}>
                    <tr className="border-b border-border/60">
                      <td className="py-1 pr-3">
                        <span className="block">
                          {user.displayName ?? <span className="text-text-muted">No name</span>}
                        </span>
                        <span className="font-mono text-[10px] text-text-muted">{user.id}</span>
                      </td>
                      <td className="py-1 pr-3">
                        {user.walletIdentities[0] ? (
                          <AddressText value={user.walletIdentities[0].address} label="Sign-in wallet" />
                        ) : (
                          "—"
                        )}
                        {user.walletIdentities.length > 1 ? (
                          <span className="ml-1 text-text-muted">+{user.walletIdentities.length - 1}</span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-3">
                        <MembershipCell user={user} />
                      </td>
                      <td
                        className={`hidden py-1 pr-3 md:table-cell ${user.status === "disabled" ? "text-negative" : "text-text-secondary"}`}
                      >
                        {user.status}
                      </td>
                      <td className="hidden py-1 pr-3 text-right font-mono tabular md:table-cell">
                        {user.activeSessionCount}
                      </td>
                      <td className="hidden py-1 pr-3 text-text-secondary lg:table-cell">
                        {user.lastActivityAt ? <Timestamp value={user.lastActivityAt} /> : "Never"}
                      </td>
                      <td className="py-1 text-right">
                        <Button
                          variant="ghost"
                          aria-expanded={expanded === user.id}
                          aria-controls={`manage-${user.id}`}
                          onClick={() => setExpanded(expanded === user.id ? null : user.id)}
                        >
                          {expanded === user.id ? "Close" : "Manage"}
                        </Button>
                      </td>
                    </tr>
                    {expanded === user.id ? (
                      <tr id={`manage-${user.id}`} className="border-b border-border bg-surface-2/50">
                        <td colSpan={7} className="px-2 py-2">
                          <MemberActions user={user} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        {users.hasNextPage ? (
          <Button
            className="mt-2"
            onClick={() => void users.fetchNextPage()}
            disabled={users.isFetchingNextPage}
          >
            {users.isFetchingNextPage ? "Loading…" : "Load more users"}
          </Button>
        ) : null}
      </Panel>
      <p className="text-[11px] text-text-muted">
        Roles and membership apply to the active organization. Ownership cannot be granted or removed here;
        ownership transfer arrives with organization management.
      </p>
    </OwnerOnly>
  );
}
