import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { apiEnvironmentSchema } from "./api-env";
import { publicEnvironmentSchema } from "./public-env";
import { terminalServerEnvironmentSchema } from "./terminal-env";
import { workerEnvironmentSchema } from "./worker-env";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const example = readFileSync(path.join(root, ".env.example"), "utf8");
const documented = new Set(
  example
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined),
);

function keysOf(schema: { in?: unknown; _zod: { def: unknown } }): string[] {
  // Unwrap ZodPipe/refinements down to the object shape.
  let current = schema as unknown as {
    shape?: Record<string, unknown>;
    _zod: { def: { in?: unknown; schema?: unknown } };
  };
  while (!current.shape) {
    const inner = current._zod.def.in ?? current._zod.def.schema;
    if (!inner) break;
    current = inner as typeof current;
  }
  return Object.keys(current.shape ?? {});
}

describe(".env.example", () => {
  it("documents every environment variable read by the api, worker, and terminal", () => {
    const schemas = [
      apiEnvironmentSchema,
      workerEnvironmentSchema,
      terminalServerEnvironmentSchema,
      publicEnvironmentSchema,
    ];
    const required = new Set(schemas.flatMap((schema) => keysOf(schema)));
    expect(required.size).toBeGreaterThan(10);
    const missing = [...required].filter((name) => !documented.has(name));
    expect(missing).toEqual([]);
  });

  it("contains no real secrets", () => {
    expect(example).toMatch(/^AUTH_SECRET=$/m);
    expect(example).toMatch(/^ENCRYPTION_KEY=$/m);
    expect(example).toMatch(/^JUPITER_API_KEY=$/m);
    expect(example).toMatch(/^HELIUS_API_KEY=$/m);
  });
});
