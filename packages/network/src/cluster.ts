/**
 * Solana cluster model (SPEC-005). Pure module: no SDK or runtime dependencies,
 * so it can be imported by configuration, browser, and server code alike.
 */

export const CLUSTERS = ["localnet", "devnet", "testnet", "mainnet-beta"] as const;

export type Cluster = (typeof CLUSTERS)[number];

/** Clusters this release is allowed to operate on. Mainnet requires the readiness gate. */
export const PERMITTED_CLUSTERS = ["localnet", "devnet", "testnet"] as const satisfies readonly Cluster[];

export type PermittedCluster = (typeof PERMITTED_CLUSTERS)[number];

export const MAINNET_NOT_PERMITTED_MESSAGE =
  "Mainnet is not permitted in this release. See OPERATIONS.md — Mainnet readiness gate.";

export function isCluster(value: unknown): value is Cluster {
  return typeof value === "string" && (CLUSTERS as readonly string[]).includes(value);
}

export function isPermittedCluster(value: unknown): value is PermittedCluster {
  return typeof value === "string" && (PERMITTED_CLUSTERS as readonly string[]).includes(value);
}

/**
 * Genesis hashes of the public clusters, retrieved live with `getGenesisHash`
 * on 2026-09-30 (see DATA_SOURCES.md §4.2). Protocol constants, not configuration.
 * Localnet genesis hashes differ per validator instance and must be configured.
 */
export const KNOWN_GENESIS_HASHES = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const satisfies Record<Exclude<Cluster, "localnet">, string>;

export function expectedGenesisHash(cluster: Cluster, localnetGenesisHash?: string): string | null {
  if (cluster === "localnet") return localnetGenesisHash ?? null;
  return KNOWN_GENESIS_HASHES[cluster];
}

/** Returns the public cluster a genesis hash belongs to, if it is a known one. */
export function clusterForGenesisHash(genesisHash: string): Exclude<Cluster, "localnet"> | null {
  for (const [cluster, hash] of Object.entries(KNOWN_GENESIS_HASHES)) {
    if (hash === genesisHash) return cluster as Exclude<Cluster, "localnet">;
  }
  return null;
}

/** Wallet Standard chain identifiers (`@solana/wallet-standard-chains`). */
export const WALLET_STANDARD_CHAINS = {
  localnet: "solana:localnet",
  devnet: "solana:devnet",
  testnet: "solana:testnet",
  "mainnet-beta": "solana:mainnet",
} as const satisfies Record<Cluster, `solana:${string}`>;

export type WalletStandardChain = (typeof WALLET_STANDARD_CHAINS)[Cluster];

export function walletChainForCluster<C extends Cluster>(cluster: C): (typeof WALLET_STANDARD_CHAINS)[C] {
  return WALLET_STANDARD_CHAINS[cluster];
}

/** Display label for the persistent network indicator (NET-AC-05). */
export function networkLabel(cluster: Cluster): string {
  switch (cluster) {
    case "localnet":
      return "SOLANA LOCALNET";
    case "devnet":
      return "SOLANA DEVNET";
    case "testnet":
      return "SOLANA TESTNET";
    case "mainnet-beta":
      return "SOLANA MAINNET";
  }
}
