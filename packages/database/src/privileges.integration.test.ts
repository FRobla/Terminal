import { integrationEnvironment } from "@sct/testing";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const app = postgres(integrationEnvironment.applicationDatabaseUrl, { max: 1, onnotice: () => undefined });

afterAll(async () => {
  await app.end({ timeout: 5 });
});

describe("application database role", () => {
  it("FND-AC-06: migrations applied and reference data seeded", async () => {
    const [{ count }] = (await app`select count(*)::int as count from permissions`) as unknown as [
      { count: number },
    ];
    expect(count).toBe(19);
    const roles = await app`select key from roles where organization_id is null order by key`;
    expect(roles.map((row) => row.key)).toEqual([
      "admin",
      "analyst",
      "auditor",
      "operator",
      "owner",
      "trader",
      "viewer",
    ]);
  });

  it("AUD-AC-02 / FND-AC-07: cannot update or delete audit events", async () => {
    await expect(app`update audit_events set action = 'tampered'`).rejects.toThrow(/permission denied/);
    await expect(app`delete from audit_events`).rejects.toThrow(/permission denied/);
    await expect(app`truncate audit_events`).rejects.toThrow(/permission denied/);
  });

  it("FND-AC-07: cannot run DDL or change reference data", async () => {
    await expect(app`create table intruder (id int)`).rejects.toThrow(/permission denied/);
    await expect(app`drop table sessions`).rejects.toThrow(/must be owner|permission denied/);
    await expect(app`delete from permissions`).rejects.toThrow(/permission denied/);
  });
});
