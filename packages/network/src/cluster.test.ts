import { describe, expect, it } from "vitest";
import {
  clusterForGenesisHash,
  expectedGenesisHash,
  isPermittedCluster,
  KNOWN_GENESIS_HASHES,
  networkLabel,
  walletChainForCluster,
} from "./cluster";
import { explorerAddressUrl, explorerTransactionUrl } from "./explorer";

describe("cluster model", () => {
  it("NET-AC-01: mainnet-beta is not a permitted cluster in this release", () => {
    expect(isPermittedCluster("mainnet-beta")).toBe(false);
    expect(isPermittedCluster("devnet")).toBe(true);
    expect(isPermittedCluster("unknown")).toBe(false);
  });

  it("NET-AC-02: maps the verified Devnet genesis hash", () => {
    expect(expectedGenesisHash("devnet")).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    expect(clusterForGenesisHash(KNOWN_GENESIS_HASHES["mainnet-beta"])).toBe("mainnet-beta");
    expect(clusterForGenesisHash("not-a-known-hash")).toBeNull();
  });

  it("uses the configured genesis hash for localnet only", () => {
    expect(expectedGenesisHash("localnet")).toBeNull();
    expect(expectedGenesisHash("localnet", "abc")).toBe("abc");
  });

  it("maps clusters to Wallet Standard chains and display labels", () => {
    expect(walletChainForCluster("devnet")).toBe("solana:devnet");
    expect(walletChainForCluster("mainnet-beta")).toBe("solana:mainnet");
    expect(networkLabel("devnet")).toBe("SOLANA DEVNET");
  });
});

describe("explorer links", () => {
  it("NET-AC-07: always carry the cluster parameter for non-Mainnet clusters", () => {
    expect(explorerAddressUrl("devnet", "11111111111111111111111111111111")).toBe(
      "https://explorer.solana.com/address/11111111111111111111111111111111?cluster=devnet",
    );
    expect(explorerTransactionUrl("testnet", "sig")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=testnet",
    );
    expect(explorerAddressUrl("localnet", "a")).toContain("cluster=custom");
  });

  it("SET-AC-06: Solscan links carry the cluster; localnet always falls back to Solana Explorer", () => {
    expect(explorerAddressUrl("devnet", "11111111111111111111111111111111", "solscan")).toBe(
      "https://solscan.io/account/11111111111111111111111111111111?cluster=devnet",
    );
    expect(explorerTransactionUrl("devnet", "sig", "solscan")).toBe(
      "https://solscan.io/tx/sig?cluster=devnet",
    );
    expect(explorerAddressUrl("localnet", "a", "solscan")).toMatch(
      /^https:\/\/explorer\.solana\.com\/address\/a\?cluster=custom/,
    );
  });
});
