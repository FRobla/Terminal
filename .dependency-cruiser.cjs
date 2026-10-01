/**
 * Architecture boundaries (ADR-0002, FND-AC-08, FND-AC-11). Run with `pnpm lint:boundaries`.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-test-code-in-runtime",
      comment: "Runtime code must never import test helpers, fixtures, or test harnesses (FND-AC-08).",
      severity: "error",
      from: {
        path: "^(apps|packages)/[^/]+/src/",
        pathNot: ["\\.test\\.tsx?$", "^packages/testing/"],
      },
      to: { path: ["^packages/testing/", "(^|/)(test|tests|__fixtures__)/", "\\.test\\.tsx?$"] },
    },
    {
      name: "domain-is-framework-free",
      comment: "Domain code must not depend on HTTP, persistence, UI frameworks, or infrastructure (ARCHITECTURE.md §6).",
      severity: "error",
      from: { path: "/domain/" },
      to: {
        path: [
          "/infrastructure/",
          "/http/",
          "/application/",
          "node_modules/(fastify|drizzle-orm|postgres|ioredis|bullmq|react|next)/",
          "^packages/database/",
        ],
      },
    },
    {
      name: "application-uses-ports-not-adapters",
      comment: "Application code depends on ports; adapters are wired in the composition root.",
      severity: "error",
      from: { path: "/application/" },
      to: { path: ["/infrastructure/", "/http/", "node_modules/(fastify|drizzle-orm|postgres|ioredis)/"] },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-utils-graveyard",
      comment: "No generic utils/helpers/common/misc modules (prompt §84).",
      severity: "error",
      from: {},
      to: { path: "(^|/)(utils|helpers|common|misc)\\.[jt]sx?$", pathNot: "node_modules" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: { path: "^(apps|packages)/" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["node_modules", "\\.next", "dist", "migrations"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs"],
    },
  },
};
