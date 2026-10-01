import { describe, expect, it } from "vitest";
import { decodeHistoryCursor, encodeHistoryCursor } from "./history-cursor";
import { canInitiateTransactions, isCategoryAllowed } from "./managed-wallet";
import {
  buildOwnershipMessage,
  checkOwnershipChallenge,
  type OwnershipChallenge,
} from "./ownership-challenge";

const now = new Date("2026-10-01T12:00:00.000Z");
const expected = { organizationId: "org", userId: "user", address: "addr", cluster: "devnet" as const };
const challenge: OwnershipChallenge = {
  id: "c",
  ...expected,
  message: "m",
  expiresAt: new Date(now.getTime() + 60_000),
  consumedAt: null,
};

describe("Ownership challenge (SPEC-009 §3)", () => {
  it("WRG-AC-02: the message names the account, network, organization, and states no transaction is authorized", () => {
    const message = buildOwnershipMessage({
      domain: "terminal.example",
      address: "addr",
      cluster: "devnet",
      organizationSlug: "default",
      nonce: "n0nce",
      issuedAt: now.toISOString(),
      expirationTime: now.toISOString(),
    });
    expect(message.split("\n")).toEqual([
      "terminal.example asks you to prove control of this Solana account for the wallet registry.",
      "",
      "Account: addr",
      "Network: devnet",
      "Organization: default",
      "Nonce: n0nce",
      `Issued At: ${now.toISOString()}`,
      `Expiration Time: ${now.toISOString()}`,
      "",
      "Signing this message does not authorize any transaction.",
    ]);
  });

  it("WRG-AC-03: rejects missing, consumed, expired, and mis-bound challenges", () => {
    expect(checkOwnershipChallenge(challenge, expected, now)).toBeNull();
    expect(checkOwnershipChallenge(null, expected, now)).toBe("CHALLENGE_NOT_FOUND");
    expect(checkOwnershipChallenge({ ...challenge, consumedAt: now }, expected, now)).toBe(
      "CHALLENGE_CONSUMED",
    );
    expect(checkOwnershipChallenge({ ...challenge, expiresAt: now }, expected, now)).toBe(
      "CHALLENGE_EXPIRED",
    );
    for (const field of ["organizationId", "userId", "address"] as const) {
      expect(checkOwnershipChallenge({ ...challenge, [field]: "other" }, expected, now)).toBe(
        "CHALLENGE_BINDING_MISMATCH",
      );
    }
    expect(checkOwnershipChallenge({ ...challenge, cluster: "testnet" }, expected, now)).toBe(
      "CHALLENGE_BINDING_MISMATCH",
    );
  });
});

describe("Managed wallet invariants (SPEC-009 §3)", () => {
  it("WRG-AC-04: the WATCH_ONLY category requires watch-only custody", () => {
    expect(isCategoryAllowed("WATCH_ONLY", "WATCH_ONLY")).toBe(true);
    expect(isCategoryAllowed("WATCH_ONLY", "BROWSER_WALLET")).toBe(false);
    expect(isCategoryAllowed("WATCH_ONLY", "LOCAL_ENCRYPTED")).toBe(false);
    expect(isCategoryAllowed("COLD_STORAGE", "WATCH_ONLY")).toBe(true);
  });

  it("TXL-AC-10: only CREATOR and CONTROLLER may initiate transactions", () => {
    expect(canInitiateTransactions(["CREATOR"])).toBe(true);
    expect(canInitiateTransactions(["VIEWER", "CONTROLLER"])).toBe(true);
    expect(canInitiateTransactions(["FUNDER", "VIEWER"])).toBe(false);
    expect(canInitiateTransactions([])).toBe(false);
  });
});

describe("History cursor", () => {
  it("WRG-AC-13: round-trips and rejects malformed cursors", () => {
    const position = { slot: 18446744073709551615n, id: "01a0f3c3-0000-7000-8000-000000000000" };
    expect(decodeHistoryCursor(encodeHistoryCursor(position))).toEqual(position);
    expect(decodeHistoryCursor("not-a-cursor")).toBeNull();
    expect(decodeHistoryCursor(Buffer.from("1:x").toString("base64url"))).toBeNull();
  });
});
