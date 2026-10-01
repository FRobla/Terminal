import { describe, expect, it } from "vitest";
import { protectionReason } from "./member-protection";

describe("member protection", () => {
  const actor = "0199a3a0-0000-7000-8000-000000000001";
  const other = "0199a3a0-0000-7000-8000-000000000002";

  it("OWN-AC-05: the caller is protected from their own console actions", () => {
    expect(protectionReason(actor, { userId: actor, roleKeys: ["owner"] })).toBe("SELF");
    expect(protectionReason(actor, { userId: actor, roleKeys: [] })).toBe("SELF");
  });

  it("OWN-AC-05: any owner is protected", () => {
    expect(protectionReason(actor, { userId: other, roleKeys: ["viewer", "owner"] })).toBe("OWNER_PROTECTED");
  });

  it("OWN-AC-04: other members, with or without roles, can be managed", () => {
    expect(protectionReason(actor, { userId: other, roleKeys: ["admin"] })).toBeNull();
    expect(protectionReason(actor, { userId: other, roleKeys: [] })).toBeNull();
  });
});
