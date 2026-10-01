import type { Redis } from "ioredis";
import type { ProviderFailureKind } from "./errors";
import { HEALTH_WINDOW_MS, type HealthSnapshot, type ProviderHealthStore } from "./health";

const MINUTE_MS = 60_000;
const LATENCY_SAMPLES = 200;

/** Live provider health counters in Redis, shared by the api and worker processes. */
export class RedisProviderHealthStore implements ProviderHealthStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sct:health",
  ) {}

  private minuteKey(providerId: string, at: Date): string {
    return `${this.prefix}:${providerId}:m:${Math.floor(at.getTime() / MINUTE_MS)}`;
  }

  private metaKey(providerId: string): string {
    return `${this.prefix}:${providerId}:meta`;
  }

  private latencyKey(providerId: string): string {
    return `${this.prefix}:${providerId}:latency`;
  }

  private async recordLatency(
    pipeline: ReturnType<Redis["multi"]>,
    providerId: string,
    latencyMs: number,
    at: Date,
  ) {
    pipeline.lpush(this.latencyKey(providerId), `${at.getTime()}:${Math.round(latencyMs)}`);
    pipeline.ltrim(this.latencyKey(providerId), 0, LATENCY_SAMPLES - 1);
  }

  async recordSuccess(providerId: string, latencyMs: number, at: Date): Promise<void> {
    const minuteKey = this.minuteKey(providerId, at);
    const pipeline = this.redis.multi();
    pipeline.hincrby(minuteKey, "requests", 1);
    pipeline.pexpire(minuteKey, HEALTH_WINDOW_MS + MINUTE_MS);
    await this.recordLatency(pipeline, providerId, latencyMs, at);
    pipeline.hset(
      this.metaKey(providerId),
      "lastSuccessAt",
      String(at.getTime()),
      "consecutiveFailures",
      "0",
    );
    await pipeline.exec();
  }

  async recordFailure(
    providerId: string,
    failure: { kind: ProviderFailureKind; message: string; retryAfterMs?: number | undefined },
    latencyMs: number | undefined,
    at: Date,
  ): Promise<void> {
    const minuteKey = this.minuteKey(providerId, at);
    const metaKey = this.metaKey(providerId);
    const pipeline = this.redis.multi();
    pipeline.hincrby(minuteKey, "requests", 1);
    pipeline.hincrby(minuteKey, "failures", 1);
    pipeline.pexpire(minuteKey, HEALTH_WINDOW_MS + MINUTE_MS);
    if (latencyMs !== undefined) await this.recordLatency(pipeline, providerId, latencyMs, at);
    pipeline.hset(
      metaKey,
      "lastFailureAt",
      String(at.getTime()),
      "lastFailureReason",
      `${failure.kind}: ${failure.message}`.slice(0, 300),
    );
    pipeline.hincrby(metaKey, "consecutiveFailures", 1);
    if (failure.kind === "RATE_LIMITED") {
      pipeline.hset(metaKey, "lastRateLimitedAt", String(at.getTime()));
      if (failure.retryAfterMs !== undefined) {
        pipeline.hset(metaKey, "rateLimitResetAt", String(at.getTime() + failure.retryAfterMs));
      }
    }
    await pipeline.exec();
  }

  async setVerificationFailure(providerId: string, reason: string | null): Promise<void> {
    if (reason === null) await this.redis.hdel(this.metaKey(providerId), "verificationFailure");
    else await this.redis.hset(this.metaKey(providerId), "verificationFailure", reason.slice(0, 300));
  }

  async setDisabled(providerId: string, disabled: boolean): Promise<void> {
    await this.redis.hset(this.metaKey(providerId), "disabled", disabled ? "1" : "0");
  }

  async read(providerId: string, at: Date): Promise<HealthSnapshot> {
    const currentMinute = Math.floor(at.getTime() / MINUTE_MS);
    const minutes = Array.from({ length: HEALTH_WINDOW_MS / MINUTE_MS }, (_, index) => currentMinute - index);
    const pipeline = this.redis.multi();
    for (const minute of minutes)
      pipeline.hmget(`${this.prefix}:${providerId}:m:${minute}`, "requests", "failures");
    pipeline.hgetall(this.metaKey(providerId));
    pipeline.lrange(this.latencyKey(providerId), 0, LATENCY_SAMPLES - 1);
    const results = (await pipeline.exec()) ?? [];

    let requests = 0;
    let failures = 0;
    for (let index = 0; index < minutes.length; index += 1) {
      const [requestCount, failureCount] = (results[index]?.[1] as (string | null)[] | undefined) ?? [];
      requests += Number(requestCount ?? 0);
      failures += Number(failureCount ?? 0);
    }
    const meta = (results[minutes.length]?.[1] as Record<string, string> | undefined) ?? {};
    const rawLatencies = (results[minutes.length + 1]?.[1] as string[] | undefined) ?? [];
    const windowStart = at.getTime() - HEALTH_WINDOW_MS;
    const latenciesMs = rawLatencies
      .map((entry) => entry.split(":").map(Number) as [number, number])
      .filter(([timestamp]) => timestamp >= windowStart)
      .map(([, latency]) => latency);

    const date = (value: string | undefined) => (value ? new Date(Number(value)) : null);
    return {
      requests,
      failures,
      latenciesMs,
      consecutiveFailures: Number(meta.consecutiveFailures ?? 0),
      lastSuccessAt: date(meta.lastSuccessAt),
      lastFailureAt: date(meta.lastFailureAt),
      lastFailureReason: meta.lastFailureReason ?? null,
      lastRateLimitedAt: date(meta.lastRateLimitedAt),
      rateLimitResetAt: date(meta.rateLimitResetAt),
      disabled: meta.disabled === "1",
      verificationFailure: meta.verificationFailure ?? null,
    };
  }
}
