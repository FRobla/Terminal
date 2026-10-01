"use client";

import { AddressText, ErrorState, FreshnessLabel, LoadingState, Panel } from "@sct/ui";
import { useSession } from "../auth/use-session";
import { useNetworkIdentity } from "../network/use-network-identity";
import { ProviderStatusText } from "./provider-status";
import { useProviderHealth } from "./use-provider-health";

function Row(props: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{props.term}</dt>
      <dd className="min-w-0 font-mono break-all">{props.children}</dd>
    </>
  );
}

/** SPEC-005 / SPEC-006 — cluster identity and provider health. */
export function SystemView() {
  const network = useNetworkIdentity();
  const { session, can } = useSession();
  const allowed = session !== null && can("system.read");
  const providers = useProviderHealth(allowed);
  const identity = network.identity;

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="Solana cluster">
        {network.isPending ? (
          <LoadingState operation="Reading cluster identity from the API…" rows={4} />
        ) : !identity ? (
          <ErrorState title="Cluster identity is unavailable." />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            <Row term="Cluster">{identity.networkLabel}</Row>
            <Row term="Verified">
              <span className={identity.verified ? "text-positive" : "text-negative"}>
                {identity.verified ? "Yes — genesis hash matches" : "No"}
              </span>
            </Row>
            <Row term="Expected genesis hash">
              {identity.expectedGenesisHash ? (
                <AddressText value={identity.expectedGenesisHash} full label="Expected genesis hash" />
              ) : (
                "Not configured"
              )}
            </Row>
            <Row term="Observed genesis hash">
              {identity.observedGenesisHash ? (
                <AddressText value={identity.observedGenesisHash} full label="Observed genesis hash" />
              ) : (
                "Not observed"
              )}
            </Row>
            <Row term="RPC provider">{identity.rpcProvider}</Row>
            <Row term="solana-core">{identity.solanaCoreVersion ?? "Unknown"}</Row>
            <Row term="Last check">
              {identity.checkedAt ? (
                <FreshnessLabel retrievedAt={identity.checkedAt} staleAfterMs={6 * 60_000} />
              ) : (
                "Never"
              )}
            </Row>
            {identity.failureReason ? <Row term="Failure">{identity.failureReason}</Row> : null}
          </dl>
        )}
      </Panel>

      <Panel title="Data providers">
        {!allowed ? (
          <p className="text-[12px] text-text-secondary">
            Provider health requires the system.read permission.
          </p>
        ) : providers.isPending ? (
          <LoadingState operation="Reading provider health…" rows={2} />
        ) : providers.isError ? (
          <ErrorState title="Provider health is unavailable." />
        ) : (
          <table className="w-full text-[12px]">
            <caption className="sr-only">Provider health over the last five minutes</caption>
            <thead className="text-left text-[11px] text-text-muted uppercase">
              <tr className="border-b border-border">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Provider
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Status
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  p50 / p95
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  Error rate
                </th>
                <th scope="col" className="py-1 font-medium">
                  Last failure
                </th>
              </tr>
            </thead>
            <tbody>
              {providers.data.map((provider) => (
                <tr key={provider.providerId} className="border-b border-border/60 last:border-0">
                  <td className="py-1 pr-3">
                    {provider.displayName} <span className="text-text-muted">({provider.network})</span>
                  </td>
                  <td className="py-1 pr-3">
                    <ProviderStatusText status={provider.status} />
                  </td>
                  <td className="py-1 pr-3 text-right font-mono tabular">
                    {provider.latencyP50Ms ?? "—"} / {provider.latencyP95Ms ?? "—"} ms
                  </td>
                  <td className="py-1 pr-3 text-right font-mono tabular">
                    {provider.errorRate === null ? "—" : `${(provider.errorRate * 100).toFixed(1)}%`}
                  </td>
                  <td className="py-1 text-text-secondary">{provider.lastFailureReason ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
