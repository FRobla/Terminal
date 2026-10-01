import type { Cluster } from "./cluster";

/** Block explorers a user can choose (SPEC-025 `explorer` preference). */
export const EXPLORERS = ["solana-explorer", "solscan"] as const;
export type Explorer = (typeof EXPLORERS)[number];

export const EXPLORER_NAMES: Record<Explorer, string> = {
  "solana-explorer": "Solana Explorer",
  solscan: "Solscan",
};

const SOLANA_EXPLORER_BASE_URL = "https://explorer.solana.com";
const SOLSCAN_BASE_URL = "https://solscan.io";

/**
 * Builds explorer links that always carry the cluster (NET-AC-07).
 * Localnet links point Solana Explorer at the default local RPC; Solscan cannot
 * show a local validator, so localnet always uses Solana Explorer.
 */
function clusterQuery(cluster: Cluster): string {
  switch (cluster) {
    case "mainnet-beta":
      return "";
    case "localnet":
      return `?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:8899")}`;
    default:
      return `?cluster=${cluster}`;
  }
}

function resolveExplorer(cluster: Cluster, explorer: Explorer): Explorer {
  return cluster === "localnet" ? "solana-explorer" : explorer;
}

export function explorerAddressUrl(
  cluster: Cluster,
  address: string,
  explorer: Explorer = "solana-explorer",
): string {
  const path = encodeURIComponent(address);
  return resolveExplorer(cluster, explorer) === "solscan"
    ? `${SOLSCAN_BASE_URL}/account/${path}${clusterQuery(cluster)}`
    : `${SOLANA_EXPLORER_BASE_URL}/address/${path}${clusterQuery(cluster)}`;
}

export function explorerTransactionUrl(
  cluster: Cluster,
  signature: string,
  explorer: Explorer = "solana-explorer",
): string {
  const path = encodeURIComponent(signature);
  return resolveExplorer(cluster, explorer) === "solscan"
    ? `${SOLSCAN_BASE_URL}/tx/${path}${clusterQuery(cluster)}`
    : `${SOLANA_EXPLORER_BASE_URL}/tx/${path}${clusterQuery(cluster)}`;
}
