import { clusterForGenesisHash, type Cluster } from "./cluster";

export interface ClusterVerificationOutcome {
  verified: boolean;
  failureReason: string | null;
  /** True when a non-Mainnet configuration is connected to Mainnet: a critical incident (SPEC-005 §3.5). */
  mainnetDetected: boolean;
}

/** Compares the RPC genesis hash with the configured cluster's expected hash (NET-AC-02, NET-AC-03). */
export function evaluateClusterIdentity(
  configuredCluster: Cluster,
  expectedGenesisHash: string | null,
  observedGenesisHash: string,
): ClusterVerificationOutcome {
  const observedCluster = clusterForGenesisHash(observedGenesisHash);
  const mainnetDetected = configuredCluster !== "mainnet-beta" && observedCluster === "mainnet-beta";
  if (expectedGenesisHash === null) {
    return { verified: false, failureReason: "No expected genesis hash is configured", mainnetDetected };
  }
  if (observedGenesisHash === expectedGenesisHash) {
    return { verified: true, failureReason: null, mainnetDetected: false };
  }
  const observedLabel = observedCluster ?? "an unknown cluster";
  return {
    verified: false,
    failureReason: `RPC genesis hash belongs to ${observedLabel}, not ${configuredCluster}`,
    mainnetDetected,
  };
}
