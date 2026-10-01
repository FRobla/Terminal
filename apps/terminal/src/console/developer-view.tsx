"use client";

import { ConfirmAction, ErrorState, LoadingState, Panel, Select, ScrollRegion } from "@sct/ui";
import type { RouteCatalogEntry } from "@sct/validation";
import { useMemo, useState } from "react";
import { ApiRequestError } from "../platform/api-client";
import { usePurgeCache, useRouteCatalog, useRuntimeInspection } from "./console-api";
import { OwnerOnly, RequestFailed } from "./owner-only";

function accessLabel(access: RouteCatalogEntry["access"]): string {
  return access.kind === "permission" ? access.permission : access.kind;
}

const ACCESS_CLASS = {
  public: "text-warning",
  session: "text-active",
  permission: "text-text-primary",
} as const;

function RouteCatalogPanel() {
  const catalog = useRouteCatalog();
  const [access, setAccess] = useState("all");
  const routes = useMemo(
    () => (catalog.data ?? []).filter((route) => access === "all" || accessLabel(route.access) === access),
    [catalog.data, access],
  );
  const accessOptions = useMemo(
    () => [...new Set((catalog.data ?? []).map((route) => accessLabel(route.access)))].sort(),
    [catalog.data],
  );

  return (
    <Panel
      title={`API routes (${routes.length})`}
      actions={
        <>
          <label htmlFor="route-access" className="text-[11px] text-text-secondary">
            Access
          </label>
          <Select
            id="route-access"
            className="!w-auto"
            value={access}
            onChange={(event) => setAccess(event.target.value)}
          >
            <option value="all">All</option>
            {accessOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {catalog.isPending ? (
        <LoadingState operation="Reading the route catalog…" rows={6} />
      ) : catalog.isError ? (
        <RequestFailed title="The route catalog could not be loaded." error={catalog.error} />
      ) : (
        <ScrollRegion label="API routes" className="max-h-[480px] overflow-auto">
          <table className="w-full text-[12px]">
            <caption className="sr-only">Every API route with its declared access requirement</caption>
            <thead className="sticky top-0 bg-surface-1 text-left text-[11px] text-text-muted uppercase">
              <tr className="border-b border-border">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Method
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Path
                </th>
                <th scope="col" className="py-1 font-medium">
                  Access
                </th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={`${route.method} ${route.url}`} className="border-b border-border/60 last:border-0">
                  <td className="py-0.5 pr-3 font-mono text-text-secondary">{route.method}</td>
                  <td className="py-0.5 pr-3 font-mono break-all">{route.url}</td>
                  <td className={`py-0.5 font-mono ${ACCESS_CLASS[route.access.kind]}`}>
                    {accessLabel(route.access)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <p className="mt-2 text-[11px] text-text-muted">
        Generated from the running API: every route must declare its access, or the API refuses to start.
      </p>
    </Panel>
  );
}

const CACHES = [
  {
    target: "wallet-overview",
    title: "Wallet Overview cache",
    description:
      "Cached balances, token accounts, and signatures (10 s TTL). The next overview reads the RPC again.",
  },
  {
    target: "permissions",
    title: "Permission cache",
    description: "Session permissions cached up to 60 s in this API process. The next request reloads them.",
  },
] as const;

function CachePanel() {
  const purge = usePurgeCache();
  const error = purge.error instanceof ApiRequestError ? purge.error : null;
  return (
    <Panel title="Caches">
      {error ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
      <ul className="space-y-3">
        {CACHES.map((cache) => (
          <li key={cache.target} className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px]">{cache.title}</p>
              <p className="text-[11px] text-text-secondary">{cache.description}</p>
              {purge.data?.target === cache.target ? (
                <p role="status" className="text-[11px] text-positive">
                  Purged {purge.data.keysDeleted} entr{purge.data.keysDeleted === 1 ? "y" : "ies"}.
                </p>
              ) : null}
            </div>
            <ConfirmAction
              variant="default"
              label="Purge"
              consequence="The next requests are slower and hit the source again."
              pending={purge.isPending && purge.variables === cache.target}
              onConfirm={() => purge.mutate(cache.target)}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ApiDocumentationPanel() {
  const runtime = useRuntimeInspection();
  const exposed = runtime.data?.configuration.openApiExposed;
  return (
    <Panel title="API documentation">
      {exposed === undefined ? (
        <LoadingState operation="Checking whether the OpenAPI document is exposed…" rows={1} />
      ) : exposed ? (
        <p className="text-[12px]">
          <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer" className="underline">
            OpenAPI document (JSON)
          </a>{" "}
          <span className="text-text-secondary">
            — generated from the Zod contracts the terminal also uses.
          </span>
        </p>
      ) : (
        <p className="text-[12px] text-text-secondary">The OpenAPI document is not exposed in production.</p>
      )}
    </Panel>
  );
}

/** OWN-AC-16 */
export function DeveloperView() {
  return (
    <OwnerOnly title="Developer">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RouteCatalogPanel />
        <div className="space-y-3">
          <CachePanel />
          <ApiDocumentationPanel />
        </div>
      </div>
    </OwnerOnly>
  );
}
