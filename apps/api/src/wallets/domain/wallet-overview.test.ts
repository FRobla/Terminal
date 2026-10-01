import { describe, expect, it } from "vitest";
import { sanitizeUntrustedText } from "./untrusted-text";
import { sortTokenAccounts, toLamportsValue, toRecentTransaction, toTokenAccount } from "./wallet-overview";

describe("wallet overview mappings", () => {
  it("WO-AC-03: maps lamports to exact decimal strings", () => {
    expect(toLamportsValue({ lamports: 18_446_744_073_709_551_615n })).toEqual({
      lamports: "18446744073709551615",
      decimals: 9,
      uiAmount: "18446744073.709551615",
    });
  });

  it("WO-AC-04: maps token accounts with exact amounts", () => {
    const account = toTokenAccount({
      tokenAccount: "t",
      mint: "m",
      owner: "o",
      programId: "p",
      tokenProgram: "token-2022",
      amount: 1_000_001n,
      decimals: 6,
      state: "frozen",
      isNative: false,
    });
    expect(account).toMatchObject({
      amount: "1000001",
      uiAmount: "1.000001",
      state: "frozen",
      tokenProgram: "token-2022",
    });
  });

  it("orders token accounts deterministically without comparing amounts of different mints", () => {
    const base = {
      programId: "p",
      amount: "1",
      decimals: 0,
      uiAmount: "1",
      state: "initialized" as const,
      isNative: false,
    };
    const sorted = sortTokenAccounts([
      { ...base, tokenAccount: "b", mint: "z", tokenProgram: "token-2022" },
      { ...base, tokenAccount: "c", mint: "b", tokenProgram: "spl-token" },
      { ...base, tokenAccount: "a", mint: "b", tokenProgram: "spl-token" },
    ]);
    expect(sorted.map((account) => account.tokenAccount)).toEqual(["a", "c", "b"]);
  });

  it("WO-AC-05: maps signatures with status, unknown block time, and a Devnet explorer link", () => {
    const transaction = toRecentTransaction(
      {
        signature: "sig",
        slot: 10n,
        blockTime: null,
        failed: true,
        confirmationStatus: "confirmed",
        memo: null,
      },
      "devnet",
    );
    expect(transaction).toEqual({
      signature: "sig",
      slot: "10",
      blockTime: null,
      status: "failed",
      confirmationStatus: "confirmed",
      memo: null,
      explorerUrl: "https://explorer.solana.com/tx/sig?cluster=devnet",
    });
  });
});

describe("sanitizeUntrustedText", () => {
  it("WO-AC-17: removes control, bidi, and zero-width characters and flattens whitespace", () => {
    expect(sanitizeUntrustedText("a\u202Eb\u2066c\u200Bd\u0000e\u0007f\uFEFF")).toBe("abcdef");
    expect(sanitizeUntrustedText("line1\nline2\ttab")).toBe("line1 line2 tab");
    expect(sanitizeUntrustedText("<b>markup stays text</b>")).toBe("<b>markup stays text</b>");
  });
});
