"use client";

import { CriticalBanner, ErrorState } from "@sct/ui";
import type { ReactNode } from "react";
import { publicConfig } from "../platform/public-config";
import { useNetworkIdentity } from "./use-network-identity";

/**
 * NET-AC-03 / NET-AC-04 — blocks blockchain features when the API cluster differs
 * from this build, and warns globally when the RPC cluster is unverified.
 */
export function ClusterGuard(props: { children: ReactNode }) {
  const { identity, clusterMismatch, isError } = useNetworkIdentity();

  if (clusterMismatch && identity) {
    return (
      <div className="p-4">
        <ErrorState title="Configuration error: cluster mismatch">
          This terminal was built for <strong>{publicConfig.NEXT_PUBLIC_SOLANA_CLUSTER}</strong> but its API
          is configured for <strong>{identity.cluster}</strong>. Blockchain features are disabled until both
          use the same cluster.
        </ErrorState>
      </div>
    );
  }

  return (
    <>
      {identity && !identity.verified ? (
        <CriticalBanner>
          Solana RPC cluster could not be verified. Blockchain data is disabled.
          {identity.failureReason ? ` Reason: ${identity.failureReason}.` : ""}
        </CriticalBanner>
      ) : null}
      {isError ? (
        <CriticalBanner>The terminal API is unreachable. Network status is unknown.</CriticalBanner>
      ) : null}
      {props.children}
    </>
  );
}
