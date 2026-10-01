import { pino, type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { currentRequestContext } from "./request-context";

/**
 * Field names whose values must never be logged (SECURITY.md §10). Matched at the
 * top level and up to four levels of nesting.
 */
export const REDACTED_FIELD_NAMES = [
  "privateKey",
  "secretKey",
  "seed",
  "mnemonic",
  "passphrase",
  "password",
  "apiKey",
  "token",
  "accessToken",
  "refreshToken",
  "csrfToken",
  "sessionToken",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  "signedMessage",
  "signature",
  "secret",
  "AUTH_SECRET",
  "ENCRYPTION_KEY",
  "DATABASE_URL",
  "REDIS_URL",
] as const;

export const REDACTION_CENSOR = "[REDACTED]";

function buildRedactPaths(): string[] {
  const paths: string[] = [];
  for (const name of REDACTED_FIELD_NAMES) {
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : `["${name}"]`;
    const join = (prefix: string) => (key.startsWith("[") ? `${prefix}${key}` : `${prefix}.${key}`);
    paths.push(key);
    paths.push(join("*"), join("*.*"), join("*.*.*"), join("*.*.*.*"));
  }
  return paths;
}

export interface CreateLoggerOptions {
  service: string;
  level: string;
  pretty?: boolean;
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    level: options.level,
    base: { service: options.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: buildRedactPaths(), censor: REDACTION_CENSOR },
    mixin() {
      const context = currentRequestContext();
      return context ? { ...context } : {};
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (options.destination) return pino(config, options.destination);
  if (options.pretty) {
    return pino({ ...config, transport: { target: "pino-pretty", options: { colorize: true } } });
  }
  return pino(config);
}

export type { Logger } from "pino";
