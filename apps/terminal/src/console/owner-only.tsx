"use client";

import { ErrorState, LoadingState } from "@sct/ui";
import type { ReactNode } from "react";
import { useSession } from "../auth/use-session";
import { ApiRequestError } from "../platform/api-client";

/**
 * OWN-AC-01 — renders console content only for holders of platform.administer.
 * This is UX only; the API enforces the permission on every console route.
 */
export function OwnerOnly(props: { title: string; children: ReactNode }) {
  const { session, can, isPending } = useSession();
  if (isPending) return <LoadingState operation="Reading your session…" rows={2} />;
  if (!session || !can("platform.administer")) {
    return (
      <ErrorState title="The owner console is available to the organization owner only.">
        Your account does not hold the platform.administer permission.
      </ErrorState>
    );
  }
  return (
    <div className="space-y-3">
      <h1 className="text-[13px] font-semibold">
        <span className="text-text-muted">Owner console / </span>
        {props.title}
      </h1>
      {props.children}
    </div>
  );
}

/** Standard error rendering for a failed console request. */
export function RequestFailed(props: { title: string; error: unknown }) {
  const error = props.error instanceof ApiRequestError ? props.error : null;
  return (
    <ErrorState title={props.title} requestId={error?.requestId}>
      {error?.message ?? "The request failed."}
    </ErrorState>
  );
}
