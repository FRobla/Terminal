import { z } from "zod";
import { parseEnvironment } from "./load";
import {
  base64Secret,
  httpUrl,
  optionalString,
  postgresUrl,
  redisUrl,
  requireLocalnetGenesis,
  runtimeSchema,
  solanaSchema,
} from "./schema-parts";

export const apiEnvironmentSchema = runtimeSchema
  .extend(solanaSchema.shape)
  .extend({
    API_PORT: z.coerce.number().int().min(1).max(65535),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    PUBLIC_APP_ORIGIN: httpUrl,
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    AUTH_SECRET: base64Secret(32),
    ENCRYPTION_KEY: optionalString(base64Secret(32)),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(43200),
    SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
    BOOTSTRAP_OWNER_WALLET_ADDRESS: optionalString(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)),
    DEFAULT_MEMBER_ROLE: optionalString(z.enum(["admin", "operator", "trader", "analyst", "auditor", "viewer"])),
  })
  .superRefine(requireLocalnetGenesis)
  .superRefine((value, ctx) => {
    if (value.DEFAULT_MEMBER_ROLE && value.APP_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["DEFAULT_MEMBER_ROLE"],
        message: "Automatic membership is not permitted when APP_ENV=production",
      });
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(env: NodeJS.ProcessEnv = process.env): ApiEnvironment {
  return parseEnvironment(apiEnvironmentSchema, env);
}
