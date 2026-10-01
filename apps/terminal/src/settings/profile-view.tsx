"use client";

import {
  AddressText,
  Button,
  ErrorState,
  FormField,
  LoadingState,
  Panel,
  SaveStatus,
  TextInput,
  Timestamp,
} from "@sct/ui";
import { displayNameSchema } from "@sct/validation";
import { useState, type FormEvent } from "react";
import { useExplorerLinks } from "../network/use-explorer-links";
import { ApiRequestError } from "../platform/api-client";
import { useProfile, useUpdateDisplayName } from "./use-settings-api";

function DisplayNameForm(props: { current: string | null }) {
  const [value, setValue] = useState(props.current ?? "");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateDisplayName();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") {
      setError(null);
      update.mutate(null);
      return;
    }
    const parsed = displayNameSchema.safeParse(trimmed);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid display name");
      return;
    }
    setError(null);
    update.mutate(parsed.data);
  };

  const apiError = update.error instanceof ApiRequestError ? update.error.message : undefined;
  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <FormField
        id="display-name"
        label="Display name"
        help="Shown in the status bar and to the organization owner. Leave empty to show your wallet address."
      >
        <TextInput
          id="display-name"
          value={value}
          maxLength={64}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby="display-name-help"
          autoComplete="nickname"
        />
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      </FormField>
      <div className="flex items-center gap-3 sm:pl-[212px]">
        <Button type="submit" variant="primary" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save profile"}
        </Button>
        <SaveStatus
          state={update.isPending ? "saving" : update.isError ? "error" : update.isSuccess ? "saved" : "idle"}
          error={apiError}
        />
      </div>
    </form>
  );
}

/** SET-AC-02, SET-AC-03 */
export function ProfileView() {
  const profile = useProfile();
  const explorer = useExplorerLinks();

  if (profile.isPending) return <LoadingState operation="Loading your profile…" rows={4} />;
  if (profile.isError) {
    const error = profile.error instanceof ApiRequestError ? profile.error : null;
    return (
      <ErrorState title="Your profile could not be loaded." requestId={error?.requestId}>
        {error?.message}
      </ErrorState>
    );
  }
  const data = profile.data;

  return (
    <div className="space-y-3">
      <h1 className="text-[13px] font-semibold">Profile</h1>
      <Panel title="Identity">
        <DisplayNameForm key={data.user.id} current={data.user.displayName} />
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          <dt className="text-text-muted">User ID</dt>
          <dd className="font-mono break-all">{data.user.id}</dd>
          <dt className="text-text-muted">Account</dt>
          <dd>{data.user.status}</dd>
          <dt className="text-text-muted">Member since</dt>
          <dd>
            <Timestamp value={data.user.createdAt} />
          </dd>
        </dl>
      </Panel>

      <Panel title="Sign-in wallets">
        <table className="w-full text-[12px]">
          <caption className="sr-only">Wallets you sign in with</caption>
          <thead className="text-left text-[11px] text-text-muted uppercase">
            <tr className="border-b border-border">
              <th scope="col" className="py-1 pr-3 font-medium">
                Address
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Cluster
              </th>
              <th scope="col" className="hidden py-1 pr-3 font-medium sm:table-cell">
                First seen
              </th>
              <th scope="col" className="py-1 font-medium">
                Last sign-in
              </th>
            </tr>
          </thead>
          <tbody>
            {data.walletIdentities.map((identity) => (
              <tr
                key={`${identity.cluster}:${identity.address}`}
                className="border-b border-border/60 last:border-0"
              >
                <td className="py-1 pr-3">
                  <AddressText
                    value={identity.address}
                    href={explorer.address(identity.address)}
                    label="Sign-in wallet"
                  />
                </td>
                <td className="py-1 pr-3 font-mono text-text-secondary">{identity.cluster}</td>
                <td className="hidden py-1 pr-3 text-text-secondary sm:table-cell">
                  <Timestamp value={identity.firstSeenAt} />
                </td>
                <td className="py-1 text-text-secondary">
                  <Timestamp value={identity.lastSeenAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-text-muted">
          Sign-in wallets identify you. They are not organization wallets and hold no funds on your behalf.
        </p>
      </Panel>

      <Panel title="Organization and access">
        {data.organization ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            <dt className="text-text-muted">Organization</dt>
            <dd>{data.organization.name}</dd>
            <dt className="text-text-muted">Roles</dt>
            <dd>
              {data.roles.length > 0
                ? data.roles.map((role) => role.name).join(", ")
                : "None (membership suspended or no role)"}
            </dd>
          </dl>
        ) : (
          <p className="text-[12px] text-text-secondary">
            Your account is not a member of any organization. Ask the organization owner for access.
          </p>
        )}
        <h3 className="mt-3 mb-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          Effective permissions ({data.permissions.length})
        </h3>
        {data.permissions.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {data.permissions.map((permission) => (
              <li
                key={permission}
                className="rounded-[var(--radius-panel)] border border-border px-1.5 font-mono text-[11px] text-text-secondary"
              >
                {permission}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-text-secondary">No permissions.</p>
        )}
      </Panel>
    </div>
  );
}
