import type { Cluster } from "./cluster";

const EXPLORER_BASE_URL = "https://explorer.solana.com";

/**
 * Builds Solana Explorer links that always carry the cluster (NET-AC-07).
 * Localnet links point the explorer at the default local RPC.
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

export function explorerAddressUrl(cluster: Cluster, address: string): string {
  return `${EXPLORER_BASE_URL}/address/${encodeURIComponent(address)}${clusterQuery(cluster)}`;
}

export function explorerTransactionUrl(cluster: Cluster, signature: string): string {
  return `${EXPLORER_BASE_URL}/tx/${encodeURIComponent(signature)}${clusterQuery(cluster)}`;
}
