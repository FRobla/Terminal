"use client";

import { networkIdentitySchema } from "@sct/validation";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../platform/api-client";
import { publicConfig } from "../platform/public-config";

/** Cluster identity reported by the API, re-checked every minute. */
export function useNetworkIdentity() {
  const query = useQuery({
    queryKey: ["system", "network"],
    queryFn: ({ signal }) => apiRequest("/system/network", networkIdentitySchema, { signal }),
    refetchInterval: 60_000,
  });
  const identity = query.data;
  return {
    ...query,
    identity,
    /** NET-AC-04: the terminal build and the API must agree on the cluster. */
    clusterMismatch: identity !== undefined && identity.cluster !== publicConfig.NEXT_PUBLIC_SOLANA_CLUSTER,
    verified: identity?.verified === true,
  };
}
