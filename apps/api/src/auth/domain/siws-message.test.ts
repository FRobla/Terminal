import { describe, expect, it } from "vitest";
import { buildSiwsMessage, diffSiwsFields, parseSiwsMessage, type SiwsFields } from "./siws-message";

const fields: SiwsFields = {
  domain: "localhost:3000",
  address: "ATZjXVsj6hbviQaii7PbUE1T6xvgoiziXX6DtKSDhhes",
  statement: "Sign in to Solana Corporate Terminal.",
  uri: "http://localhost:3000",
  version: "1",
  chainId: "devnet",
  nonce: "f8e40ba0df0ea6f2ac3e4175131d1368",
  issuedAt: "2026-09-30T19:21:11.316Z",
  expirationTime: "2026-09-30T19:26:11.316Z",
};

describe("SIWS message", () => {
  it("builds the wallet-standard SIWS text layout", () => {
    expect(buildSiwsMessage(fields)).toBe(
      [
        "localhost:3000 wants you to sign in with your Solana account:",
        fields.address,
        "",
        fields.statement,
        "",
        "URI: http://localhost:3000",
        "Version: 1",
        "Chain ID: devnet",
        `Nonce: ${fields.nonce}`,
        `Issued At: ${fields.issuedAt}`,
        `Expiration Time: ${fields.expirationTime}`,
      ].join("\n"),
    );
  });

  it("round-trips through the parser", () => {
    expect(parseSiwsMessage(buildSiwsMessage(fields))).toEqual(fields);
  });

  it("AUTH-AC-03: detects every tampered field", () => {
    const tampered = parseSiwsMessage(
      buildSiwsMessage({ ...fields, domain: "evil.example", nonce: "other", chainId: "mainnet" }),
    );
    if (!tampered) throw new Error("expected a parsed message");
    expect(diffSiwsFields(tampered, fields).sort()).toEqual(["chainId", "domain", "nonce"]);
  });

  it("rejects non-SIWS text and unexpected fields", () => {
    expect(parseSiwsMessage("hello world")).toBeNull();
    expect(parseSiwsMessage(`${buildSiwsMessage(fields)}\nResources:`)).toBeNull();
    expect(parseSiwsMessage(`${buildSiwsMessage(fields)}\nRequest ID: 1`)).toBeNull();
  });

  it("treats a missing statement as a difference", () => {
    const parsed = parseSiwsMessage(buildSiwsMessage({ ...fields, statement: "" }));
    if (!parsed) throw new Error("expected a parsed message");
    expect(diffSiwsFields(parsed, fields)).toEqual(["statement"]);
  });
});
