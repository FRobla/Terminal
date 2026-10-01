import type { z } from "zod";

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

/**
 * Parses environment variables with a schema (FND-AC-03). Error messages name the
 * variable and the violated rule but never include the received value, so secrets
 * cannot leak through startup failures.
 */
export function parseEnvironment<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const variable = issue.path.length > 0 ? issue.path.join(".") : "(environment)";
    return `${variable}: ${issue.message}`;
  });
  throw new ConfigurationError(issues);
}
