import { describe, expect, it } from "vitest";
import {
  registerWalletRequestSchema,
  updateWalletRequestSchema,
  walletNotesSchema,
  walletTagsSchema,
} from "./registry-contracts";

const address = "11111111111111111111111111111112";

describe("Wallet registry contracts (SPEC-009 §3)", () => {
  it("WRG-AC-04: tags are normalized to lowercase, distinct, and at most ten", () => {
    expect(walletTagsSchema.parse([" Ops ", "q4-review"])).toEqual(["ops", "q4-review"]);
    expect(walletTagsSchema.safeParse(["ops", "OPS"]).success).toBe(false);
    expect(walletTagsSchema.safeParse(["with space"]).success).toBe(false);
    expect(walletTagsSchema.safeParse(["x".repeat(33)]).success).toBe(false);
    expect(walletTagsSchema.safeParse(Array.from({ length: 11 }, (_, i) => `t${i}`)).success).toBe(false);
  });

  it("WRG-AC-04: notes allow line breaks but no other control or format characters", () => {
    expect(walletNotesSchema.parse("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
    expect(walletNotesSchema.safeParse("tab\there").success).toBe(false);
    expect(walletNotesSchema.safeParse("bidi\u202Eoverride").success).toBe(false);
    expect(walletNotesSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });

  it("WRG-AC-02/03: controlled custody requires an ownership proof; watch-only rejects one", () => {
    const base = { address, label: "Wallet", category: "TREASURY" };
    expect(registerWalletRequestSchema.safeParse({ ...base, custodyType: "BROWSER_WALLET" }).success).toBe(
      false,
    );
    expect(
      registerWalletRequestSchema.safeParse({
        ...base,
        custodyType: "WATCH_ONLY",
        ownership: { challengeId: "01a0f3c3-0000-7000-8000-000000000000", signature: "AA==" },
      }).success,
    ).toBe(false);
    expect(registerWalletRequestSchema.safeParse({ ...base, custodyType: "WATCH_ONLY" }).success).toBe(true);
  });

  it("WRG-AC-08: updates reject immutable fields and empty bodies", () => {
    expect(updateWalletRequestSchema.safeParse({}).success).toBe(false);
    expect(updateWalletRequestSchema.safeParse({ address }).success).toBe(false);
    expect(updateWalletRequestSchema.safeParse({ custodyType: "WATCH_ONLY" }).success).toBe(false);
    expect(updateWalletRequestSchema.safeParse({ label: "Renamed", status: "archived" }).success).toBe(true);
  });
});
