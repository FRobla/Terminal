import { z } from "zod";
import { permittedClusterSchema } from "./schema-parts";

/**
 * Browser-exposed configuration. Only `NEXT_PUBLIC_*` variables may appear here.
 * Values must be passed explicitly (e.g. `process.env.NEXT_PUBLIC_SOLANA_CLUSTER`)
 * so the Next.js compiler can inline them.
 */
export const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SOLANA_CLUSTER: permittedClusterSchema,
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export function parsePublicEnvironment(values: Record<string, string | undefined>): PublicEnvironment {
  const result = publicEnvironmentSchema.safeParse(values);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid public configuration: ${issues.join("; ")}`);
}
