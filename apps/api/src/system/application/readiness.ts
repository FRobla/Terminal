import type { ReadinessResponse } from "@sct/validation";

export interface ReadinessProbes {
  pingDatabase: () => Promise<void>;
  pingRedis: () => Promise<void>;
  isClusterVerified: () => boolean;
}

async function check(probe: () => Promise<void>): Promise<ReadinessResponse["checks"]["database"]> {
  try {
    await probe();
    return { status: "ok" };
  } catch {
    // Details stay in server logs; readiness output never exposes hostnames or credentials.
    return { status: "failed", message: "Dependency is unreachable" };
  }
}

/** Readiness of PostgreSQL, Redis, and Solana cluster verification (API.md §4.1). */
export async function checkReadiness(probes: ReadinessProbes): Promise<ReadinessResponse> {
  const [database, redis] = await Promise.all([check(probes.pingDatabase), check(probes.pingRedis)]);
  const solanaCluster = probes.isClusterVerified()
    ? ({ status: "ok" } as const)
    : ({ status: "failed", message: "Solana cluster is not verified" } as const);
  const ready = database.status === "ok" && redis.status === "ok" && solanaCluster.status === "ok";
  return { status: ready ? "ready" : "not_ready", checks: { database, redis, solanaCluster } };
}
