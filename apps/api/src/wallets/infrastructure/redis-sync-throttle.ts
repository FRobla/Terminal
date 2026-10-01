import type { Redis } from "ioredis";
import type { SyncRequestThrottle } from "../application/registry-ports";

/** One accepted manual sync per wallet per window (WRG-AC-14). */
export class RedisSyncThrottle implements SyncRequestThrottle {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sct:wallets:sync-request",
  ) {}

  async acquire(walletId: string, windowMs: number): Promise<number> {
    const key = `${this.prefix}:${walletId}`;
    const accepted = await this.redis.set(key, "1", "PX", windowMs, "NX");
    if (accepted === "OK") return 0;
    const remaining = await this.redis.pttl(key);
    return remaining > 0 ? remaining : windowMs;
  }
}
