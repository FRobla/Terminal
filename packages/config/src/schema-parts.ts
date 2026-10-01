import { CLUSTERS, isPermittedCluster, MAINNET_NOT_PERMITTED_MESSAGE } from "@sct/network";
import { z } from "zod";

/** Empty strings in `.env` files mean "not set". */
export const optionalString = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const httpUrl = z.url({ protocol: /^https?$/ });
export const wsUrl = z.url({ protocol: /^wss?$/ });

export const permittedClusterSchema = z
  .enum(CLUSTERS)
  .refine(isPermittedCluster, { message: MAINNET_NOT_PERMITTED_MESSAGE });

export const runtimeSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  APP_ENV: z.enum(["local", "ci", "staging", "production"]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString(httpUrl),
});

export const solanaSchema = z.object({
  SOLANA_CLUSTER: permittedClusterSchema,
  SOLANA_RPC_URL: httpUrl,
  SOLANA_WS_URL: optionalString(wsUrl),
  SOLANA_RPC_FALLBACK_URL: optionalString(httpUrl),
  SOLANA_EXPECTED_GENESIS_HASH: optionalString(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)),
});

/** Requires a configured genesis hash for localnet, where there is no built-in constant. */
export function requireLocalnetGenesis(
  value: { SOLANA_CLUSTER: string; SOLANA_EXPECTED_GENESIS_HASH?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.SOLANA_CLUSTER === "localnet" && !value.SOLANA_EXPECTED_GENESIS_HASH) {
    ctx.addIssue({
      code: "custom",
      path: ["SOLANA_EXPECTED_GENESIS_HASH"],
      message: "Required when SOLANA_CLUSTER=localnet",
    });
  }
}

/** Base64-encoded secret with a minimum decoded length. */
export const base64Secret = (minBytes: number) =>
  z.string().refine((value) => {
    try {
      return Buffer.from(value, "base64").length >= minBytes;
    } catch {
      return false;
    }
  }, `Must be base64 encoding at least ${minBytes} random bytes`);

export const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
export const redisUrl = z.url({ protocol: /^rediss?$/ });
