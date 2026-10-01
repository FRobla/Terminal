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

  /**
   * OWN-AC-16: deletes cached overview sections so the next request reads the RPC again.
   * Last-success markers are kept: they record history, not cached data.
   */
  async purge(): Promise<number> {
    const lastSuccessPrefix = `${this.prefix}:last-success:`;
    let cursor = "0";
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", `${this.prefix}:*`, "COUNT", 500);
      cursor = next;
      const sections = keys.filter((key) => !key.startsWith(lastSuccessPrefix));
      if (sections.length > 0) deleted += await this.redis.del(...sections);
    } while (cursor !== "0");
    return deleted;
  }
}
