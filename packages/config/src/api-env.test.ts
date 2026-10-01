import { describe, expect, it } from "vitest";
import { loadApiEnvironment } from "./api-env";
import { ConfigurationError } from "./load";

const SECRET = Buffer.alloc(32, 7).toString("base64");

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  APP_ENV: "local",
  SOLANA_CLUSTER: "devnet",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  SOLANA_RPC_FALLBACK_URL: "",
  API_PORT: "4000",
  PUBLIC_APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:super-secret-password@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: SECRET,
};

function captureError(env: NodeJS.ProcessEnv): ConfigurationError {
  try {
    loadApiEnvironment(env);
  } catch (error) {
    if (error instanceof ConfigurationError) return error;
    throw error;
  }
  throw new Error("Expected configuration to be rejected");
}

describe("loadApiEnvironment", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = loadApiEnvironment(validEnvironment);
    expect(env.API_PORT).toBe(4000);
    expect(env.SESSION_TTL_SECONDS).toBe(43200);
    expect(env.SOLANA_RPC_FALLBACK_URL).toBeUndefined();
  });

  it("NET-AC-01: rejects mainnet-beta with the readiness gate message", () => {
    const error = captureError({ ...validEnvironment, SOLANA_CLUSTER: "mainnet-beta" });
    expect(error.message).toContain("SOLANA_CLUSTER: Mainnet is not permitted in this release");
  });

  it("FND-AC-03: names each invalid variable without printing secret values", () => {
    const error = captureError({
      ...validEnvironment,
      DATABASE_URL: "not a url with super-secret-password",
      AUTH_SECRET: "c2hvcnQ=",
      REDIS_URL: undefined,
    });
    expect(error.issues.some((issue) => issue.startsWith("DATABASE_URL:"))).toBe(true);
    expect(error.issues.some((issue) => issue.startsWith("AUTH_SECRET:"))).toBe(true);
    expect(error.issues.some((issue) => issue.startsWith("REDIS_URL:"))).toBe(true);
    expect(error.message).not.toContain("super-secret-password");
    expect(error.message).not.toContain("c2hvcnQ=");
  });

  it("RBAC-AC-05: accepts a default member role outside production and rejects it in production", () => {
    expect(loadApiEnvironment({ ...validEnvironment, DEFAULT_MEMBER_ROLE: "admin" }).DEFAULT_MEMBER_ROLE).toBe("admin");
    expect(captureError({ ...validEnvironment, DEFAULT_MEMBER_ROLE: "owner" }).message).toContain(
      "DEFAULT_MEMBER_ROLE",
    );
    expect(
      captureError({ ...validEnvironment, APP_ENV: "production", DEFAULT_MEMBER_ROLE: "admin" }).message,
    ).toContain("DEFAULT_MEMBER_ROLE: Automatic membership is not permitted when APP_ENV=production");
  });

  it("requires a genesis hash for localnet", () => {
    const error = captureError({ ...validEnvironment, SOLANA_CLUSTER: "localnet" });
    expect(error.message).toContain("SOLANA_EXPECTED_GENESIS_HASH");
  });
});
