import { evaluateClusterIdentity, expectedGenesisHash, type Cluster } from "@sct/network";
import type { Logger } from "@sct/observability";
import { toProviderHealth, type ProviderHealthStore } from "@sct/providers";
import type { ClusterIdentityReader, SolanaRpcClient } from "@sct/solana";
import type { ProviderHealth } from "@sct/validation";

export const PROBE_INTERVAL_MS = 60_000;
/** Genesis hash re-verification cadence, in probe runs (every 5 minutes). */
export const GENESIS_CHECK_EVERY_RUNS = 5;

export interface ProviderHealthSnapshotWriter {
  write(health: ProviderHealth): Promise<void>;
}

/**
 * `system.provider-health` job (SPEC-006 §3): one `getSlot` probe per minute,
 * a genesis-hash check every five minutes, and a health snapshot to PostgreSQL.
 * All calls go through the provider pipeline, so they respect the shared budget.
 */
export class ProviderHealthProbe {
  private runs = 0;

  constructor(
    private readonly config: { cluster: Cluster; localnetGenesisHash?: string | undefined },
    private readonly deps: {
      rpc: SolanaRpcClient;
      identity: ClusterIdentityReader;
      health: ProviderHealthStore;
      snapshots: ProviderHealthSnapshotWriter;
      logger: Logger;
      now?: () => Date;
    },
  ) {}

  async run(): Promise<ProviderHealth> {
    const descriptor = this.deps.rpc.descriptor;
    const checkGenesis = this.runs % GENESIS_CHECK_EVERY_RUNS === 0;
    this.runs += 1;

    try {
      await this.deps.rpc.call("getSlot", (abortSignal) => this.deps.rpc.rpc.getSlot().send({ abortSignal }));
    } catch (error) {
      // The failure is already recorded by the provider pipeline.
      this.deps.logger.warn({ err: error, providerId: descriptor.id }, "RPC health probe failed");
    }

    if (checkGenesis) {
      try {
        const identity = await this.deps.identity.read();
        const outcome = evaluateClusterIdentity(
          this.config.cluster,
          expectedGenesisHash(this.config.cluster, this.config.localnetGenesisHash),
          identity.genesisHash,
        );
        await this.deps.health.setVerificationFailure(descriptor.id, outcome.failureReason);
        if (outcome.mainnetDetected) {
          this.deps.logger.fatal(
            { providerId: descriptor.id },
            "CRITICAL: the configured RPC serves Solana Mainnet.",
          );
        }
      } catch (error) {
        this.deps.logger.warn({ err: error, providerId: descriptor.id }, "Genesis hash probe failed");
      }
    }

    const now = this.deps.now?.() ?? new Date();
    const health = toProviderHealth(descriptor, await this.deps.health.read(descriptor.id, now), now);
    await this.deps.snapshots.write(health);
    return health;
  }
}
