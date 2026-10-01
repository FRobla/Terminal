import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (TESTING.md §2, §7). The API talks to the real Devnet RPC and
 * uses the integration test database and Redis logical database. Stop local dev
 * servers on ports 3000/4000 before running. The terminal must be built first
 * (`pnpm test:e2e` does this).
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://sct_app:change-me@localhost:5432/solana_terminal_test";
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

const shared = {
  NODE_ENV: "production",
  APP_ENV: "ci",
  SOLANA_CLUSTER: "devnet",
  NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
  PUBLIC_APP_ORIGIN: "http://localhost:3000",
  API_INTERNAL_URL: "http://localhost:4000",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@responsive/ },
  ],
  webServer: [
    {
      command: "pnpm --filter @sct/api exec tsx src/main.ts",
      url: "http://localhost:4000/api/v1/system/health",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...shared,
        SOLANA_RPC_URL: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
        API_PORT: "4000",
        API_HOST: "127.0.0.1",
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        AUTH_SECRET: randomBytes(32).toString("base64"),
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "pnpm --filter @sct/terminal exec next start --port 3000",
      url: "http://localhost:3000",
      timeout: 60_000,
      reuseExistingServer: false,
      env: shared,
    },
  ],
});
