import type { RedisFacts } from "@sct/validation";
import type { Redis } from "ioredis";
import type { RedisInspector as RedisInspectorPort } from "../application/console-ports";

/** Parses the `INFO` reply (`key:value` lines grouped under `# Section` headers). */
export function parseRedisInfo(info: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return fields;
}

function integerField(fields: Map<string, string>, key: string): number {
  const value = Number.parseInt(fields.get(key) ?? "", 10);
  if (!Number.isFinite(value)) throw new Error(`Redis INFO is missing ${key}`);
  return value;
}

/** Redis facts for the owner console (OWN-AC-12). Only `INFO` and `DBSIZE`; no key contents. */
export class RedisInspector implements RedisInspectorPort {
  constructor(private readonly redis: Redis) {}

  async inspect(): Promise<RedisFacts> {
    const [info, keyCount] = await Promise.all([this.redis.info(), this.redis.dbsize()]);
    const fields = parseRedisInfo(info);
    return {
      version: fields.get("redis_version") ?? "unknown",
      mode: fields.get("redis_mode") ?? "unknown",
      uptimeSeconds: integerField(fields, "uptime_in_seconds"),
      usedMemoryBytes: integerField(fields, "used_memory"),
      connectedClients: integerField(fields, "connected_clients"),
      keyCount,
    };
  }
}
