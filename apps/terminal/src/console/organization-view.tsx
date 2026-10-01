"use client";

import {
  Button,
  FormField,
  LoadingState,
  Panel,
  SaveStatus,
  TextInput,
  Timestamp,
  ScrollRegion,
} from "@sct/ui";
import { organizationNameSchema, type AdminOrganization } from "@sct/validation";
import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../platform/api-client";
import { useAdminOrganization, useRenameOrganization, useRoleMatrix } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";

function RenameForm(props: { organization: AdminOrganization }) {
  const [name, setName] = useState(props.organization.name);
  const [error, setError] = useState<string | null>(null);
  const rename = useRenameOrganization();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = organizationNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setError(null);
    rename.mutate(parsed.data);
  };
  const apiError = rename.error instanceof ApiRequestError ? rename.error.message : undefined;

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <FormField id="organization-name" label="Name" help="Shown in the status bar to every member.">
        <TextInput
          id="organization-name"
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby="organization-name-help"
        />
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      </FormField>
      <div className="flex items-center gap-3 sm:pl-[212px]">
        <Button
          type="submit"
          variant="primary"
          disabled={rename.isPending || name.trim() === props.organization.name}
        >
          {rename.isPending ? "Saving…" : "Rename organization"}
        </Button>
        <SaveStatus
          state={rename.isPending ? "saving" : rename.isError ? "error" : rename.isSuccess ? "saved" : "idle"}
          error={apiError}
        />
      </div>
    </form>
  );
}

function RoleMatrixPanel() {
  const matrix = useRoleMatrix();
  return (
    <Panel title="Roles and permissions">
      {matrix.isPending ? (
        <LoadingState operation="Reading roles and permissions…" rows={6} />
      ) : matrix.isError ? (
        <RequestFailed title="The role matrix could not be loaded." error={matrix.error} />
      ) : (
        <ScrollRegion label="Role and permission matrix">
          <table className="w-full text-[11px]">
            <caption className="sr-only">Which role holds which permission</caption>
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th scope="col" className="py-1 pr-3 font-medium uppercase">
                  Permission
                </th>
                {matrix.data.roles.map((role) => (
                  <th key={role.key} scope="col" className="px-1 py-1 text-center font-medium">
                    {role.name}
                    <span className="block font-mono text-[10px] text-text-muted">
                      {role.activeMembers} active
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.data.permissions.map((permission) => (
                <tr key={permission.key} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="py-0.5 pr-3 text-left font-normal">
                    <span className="font-mono">{permission.key}</span>
                    <span className="block text-[10px] text-text-muted">{permission.description}</span>
                  </th>
                  {matrix.data.roles.map((role) => {
                    const held = role.permissions.includes(permission.key);
                    return (
                      <td
                        key={role.key}
                        className={`px-1 text-center font-mono ${held ? "text-positive" : "text-text-muted"}`}
                      >
                        {held ? "✓" : "—"}
                        <span className="sr-only">
                          {held
                            ? `${role.name} holds ${permission.key}`
                            : `${role.name} lacks ${permission.key}`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Panel>
  );
}

/** OWN-AC-10 */
export function OrganizationView() {
  const organization = useAdminOrganization();
  return (
    <OwnerOnly title="Organization">
      <Panel title="Organization">
        {organization.isPending ? (
          <LoadingState operation="Reading the organization…" rows={3} />
        ) : organization.isError ? (
          <RequestFailed title="The organization could not be loaded." error={organization.error} />
        ) : (
          <>
            <RenameForm key={organization.data.id} organization={organization.data} />
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-text-muted">Slug</dt>
              <dd className="font-mono">{organization.data.slug}</dd>
              <dt className="text-text-muted">ID</dt>
              <dd className="font-mono break-all">{organization.data.id}</dd>
              <dt className="text-text-muted">Members</dt>
              <dd>
                {organization.data.members.active} active · {organization.data.members.suspended} suspended
              </dd>
              <dt className="text-text-muted">Created</dt>
              <dd>
                <Timestamp value={organization.data.createdAt} />
              </dd>
              <dt className="text-text-muted">Last change</dt>
              <dd>
                <Timestamp value={organization.data.updatedAt} />
              </dd>
            </dl>
          </>
        )}
      </Panel>
      <RoleMatrixPanel />
    </OwnerOnly>
  );
}
