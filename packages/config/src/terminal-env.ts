import { z } from "zod";
import { parseEnvironment } from "./load";
import { httpUrl, permittedClusterSchema } from "./schema-parts";

/** Server-side configuration of the Next.js terminal (never sent to the browser). */
export const terminalServerEnvironmentSchema = z
  .object({
    API_INTERNAL_URL: httpUrl,
    PUBLIC_APP_ORIGIN: httpUrl,
    SOLANA_CLUSTER: permittedClusterSchema,
    NEXT_PUBLIC_SOLANA_CLUSTER: permittedClusterSchema,
  })
  .refine((env) => env.SOLANA_CLUSTER === env.NEXT_PUBLIC_SOLANA_CLUSTER, {
    path: ["NEXT_PUBLIC_SOLANA_CLUSTER"],
    message: "Must equal SOLANA_CLUSTER",
  });

export type TerminalServerEnvironment = z.infer<typeof terminalServerEnvironmentSchema>;

export function loadTerminalServerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): TerminalServerEnvironment {
  return parseEnvironment(terminalServerEnvironmentSchema, env);
}
