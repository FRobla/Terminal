import type { z } from "zod";
import { parseEnvironment } from "./load";
import { postgresUrl, redisUrl, requireLocalnetGenesis, runtimeSchema, solanaSchema } from "./schema-parts";

export const workerEnvironmentSchema = runtimeSchema
  .extend(solanaSchema.shape)
  .extend({
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
  })
  .superRefine(requireLocalnetGenesis);

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function loadWorkerEnvironment(env: NodeJS.ProcessEnv = process.env): WorkerEnvironment {
  return parseEnvironment(workerEnvironmentSchema, env);
}
