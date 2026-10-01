import type { Logger } from "@sct/observability";
import type { RuntimeInspection as RuntimeInspectionResult } from "@sct/validation";
import type { DatabaseInspector, RedisInspector } from "./console-ports";

type RuntimeConfiguration = RuntimeInspectionResult["configuration"];

/**
 * SPEC-026 OWN-AC-12 — runtime facts for the owner console. Configuration is an
 * allowlist assembled by the composition root; secrets are never part of it.
 */
export class RuntimeInspection {
  constructor(
    private readonly config: { configuration: RuntimeConfiguration; startedAt: Date },
    private readonly deps: { database: DatabaseInspector; redis: RedisInspector; logger: Logger },
  ) {}

  private async section<T>(source: string, read: () => Promise<T>) {
    const started = performance.now();
    try {
      const value = await read();
      return {
        status: "AVAILABLE" as const,
        value,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
      };
    } catch (error) {
      // The reason shown to the owner is generic; the cause stays in server logs.
      this.deps.logger.warn({ err: error, source }, "Runtime inspection failed");
      return { status: "UNAVAILABLE" as const, reason: `${source} could not be inspected.`, source };
    }
  }

  async inspect(): Promise<RuntimeInspectionResult> {
    const memory = process.memoryUsage();
    const [database, redis] = await Promise.all([
      this.section("PostgreSQL", () => this.deps.database.inspect()),
      this.section("Redis", () => this.deps.redis.inspect()),
    ]);
    return {
      configuration: this.config.configuration,
      process: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        startedAt: this.config.startedAt.toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
      database,
      redis,
    };
  }
}
