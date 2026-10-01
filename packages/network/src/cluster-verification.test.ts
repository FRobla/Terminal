import { describe, expect, it } from "vitest";
import { KNOWN_GENESIS_HASHES } from "./cluster";
import { evaluateClusterIdentity } from "./cluster-verification";

describe("evaluateClusterIdentity", () => {
  it("NET-AC-02: verifies a matching genesis hash", () => {
    expect(
      evaluateClusterIdentity("devnet", KNOWN_GENESIS_HASHES.devnet, KNOWN_GENESIS_HASHES.devnet),
    ).toEqual({
      verified: true,
      failureReason: null,
      mainnetDetected: false,
    });
  });

  it("NET-AC-03: flags Mainnet behind a Devnet configuration as a critical mismatch", () => {
    const outcome = evaluateClusterIdentity(
      "devnet",
      KNOWN_GENESIS_HASHES.devnet,
      KNOWN_GENESIS_HASHES["mainnet-beta"],
    );
    expect(outcome.verified).toBe(false);
    expect(outcome.mainnetDetected).toBe(true);
    expect(outcome.failureReason).toBe("RPC genesis hash belongs to mainnet-beta, not devnet");
  });

  it("rejects unknown clusters and missing expectations", () => {
    expect(evaluateClusterIdentity("devnet", KNOWN_GENESIS_HASHES.devnet, "unknown").failureReason).toContain(
      "an unknown cluster",
    );
    expect(evaluateClusterIdentity("localnet", null, "abc").verified).toBe(false);
  });
});
