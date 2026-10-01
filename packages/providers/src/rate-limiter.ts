import type { Redis } from "ioredis";

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until one token is available again (0 when allowed). */
  retryAfterMs: number;
}

export interface TokenBucketSpec {
  /** Tokens added per window; also the bucket capacity. */
  capacity: number;
  windowMs: number;
}

/** Distributed limiter shared by every process that calls a provider (ADR-0007). */
export interface RateLimiter {
  acquire(key: string, spec: TokenBucketSpec): Promise<RateLimitDecision>;
}

/**
 * Atomic token bucket: refills continuously at capacity/windowMs, takes one token.
 * Uses Redis server time so all processes agree on the clock.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local state = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(state[1])
local updated = tonumber(state[2])
if tokens == nil then
  tokens = capacity
  updated = now
end
local rate = capacity / window_ms
tokens = math.min(capacity, tokens + (now - updated) * rate)
local allowed = 0
local retry_after = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after = math.ceil((1 - tokens) / rate)
end
redis.call('HSET', key, 'tokens', tostring(tokens), 'updated', tostring(now))
redis.call('PEXPIRE', key, window_ms * 2)
return { allowed, retry_after }
`;

export class RedisTokenBucketLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sct:ratelimit",
  ) {}

  async acquire(key: string, spec: TokenBucketSpec): Promise<RateLimitDecision> {
    const result = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      `${this.prefix}:${key}`,
      String(spec.capacity),
      String(spec.windowMs),
    )) as [number, number];
    return { allowed: result[0] === 1, retryAfterMs: result[1] };
  }
}
