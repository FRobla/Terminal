import { describe, expect, it } from "vitest";
import { migrationStatus } from "./postgres-inspector";
import { parseRedisInfo } from "./redis-inspector";

describe("runtime inspection parsing", () => {
  const committed = [
    { tag: "0000_initial", createdAtMillis: 100 },
    { tag: "0001_privileges", createdAtMillis: 200 },
    { tag: "0002_settings", createdAtMillis: 300 },
  ];

  it("OWN-AC-12: reports committed migrations newer than the latest applied one as pending", () => {
    expect(migrationStatus([100, 200], committed)).toEqual({
      applied: 2,
      committed: 3,
      latestAppliedTag: "0001_privileges",
      pending: ["0002_settings"],
    });
    expect(migrationStatus([100, 200, 300], committed).pending).toEqual([]);
    expect(migrationStatus([], committed)).toMatchObject({ applied: 0, latestAppliedTag: null });
    expect(migrationStatus([], committed).pending).toHaveLength(3);
  });

  it("OWN-AC-12: parses Redis INFO sections and ignores headers", () => {
    const fields = parseRedisInfo(
      "# Server\r\nredis_version:8.8.3\r\nredis_mode:standalone\r\n\r\n# Memory\r\nused_memory:1024\r\n",
    );
    expect(fields.get("redis_version")).toBe("8.8.3");
    expect(fields.get("used_memory")).toBe("1024");
    expect(fields.has("# Server")).toBe(false);
  });
});
