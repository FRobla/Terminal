import { defineConfig } from "vitest/config";

const sourceRoots = ["apps/*/src/**", "packages/*/src/**", "packages/*/scripts/**"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: sourceRoots.map((root) => `${root}/*.test.ts`),
          exclude: ["**/*.integration.test.ts", "**/*.devnet.test.ts", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: sourceRoots.map((root) => `${root}/*.integration.test.ts`),
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ["./tests/integration/global-setup.ts"],
        },
      },
      {
        test: {
          name: "devnet",
          include: [
            "tests/devnet/**/*.devnet.test.ts",
            ...sourceRoots.map((root) => `${root}/*.devnet.test.ts`),
          ],
          environment: "node",
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["apps/api/src/**", "apps/worker/src/**", "packages/*/src/**"],
      exclude: ["**/*.test.ts", "packages/testing/**"],
    },
  },
});
