import type { Sourced } from "@sct/validation";
import type { Redis } from "ioredis";
import type { OverviewSectionCache } from "../application/get-wallet-overview";

const LAST_SUCCESS_TTL_SECONDS = 7 * 24 * 60 * 60;

export class RedisOverviewCache implements OverviewSectionCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sct:wallets:overview",
  ) {}

  async get<T>(key: string): Promise<Sourced<T> | null> {
    const raw = await this.redis.get(`${this.prefix}:${key}`);
    return raw ? (JSON.parse(raw) as Sourced<T>) : null;
  }

  async set<T>(key: string, value: Sourced<T>, ttlMs: number): Promise<void> {
    await this.redis.set(`${this.prefix}:${key}`, JSON.stringify(value), "PX", ttlMs);
  }

  async getLastSuccess(key: string): Promise<string | null> {
    return this.redis.get(`${this.prefix}:last-success:${key}`);
  }

  async setLastSuccess(key: string, retrievedAt: string): Promise<void> {
    await this.redis.set(`${this.prefix}:last-success:${key}`, retrievedAt, "EX", LAST_SUCCESS_TTL_SECONDS);
  }
}
