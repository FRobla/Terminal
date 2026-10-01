import { evaluateClusterIdentity, expectedGenesisHash, networkLabel, type Cluster } from "@sct/network";
import type { Logger } from "@sct/observability";
import { isProviderError, type ProviderHealthStore } from "@sct/providers";
import type { ClusterIdentityReader } from "@sct/solana";
import type { NetworkIdentity } from "@sct/validation";

export const VERIFIED_RECHECK_INTERVAL_MS = 5 * 60_000;
export const UNVERIFIED_RECHECK_INTERVAL_MS = 30_000;

/**
 * Holds the cluster verification state of this process. Solana operations are
 * disabled until verification succeeds, and again if it later fails (SPEC-005).
 */
export class ClusterVerificationService {
  private state: {
    observedGenesisHash: string | null;
    verified: boolean;
    verifiedAt: Date | null;
    checkedAt: Date | null;
    solanaCoreVersion: string | null;
    failureReason: string | null;
  } = {
    observedGenesisHash: null,
    verified: false,
    verifiedAt: null,
    checkedAt: null,
    solanaCoreVersion: null,
    failureReason: "Cluster verification has not run yet",
  };
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly config: {
      cluster: Cluster;
      localnetGenesisHash?: string | undefined;
      providerId: string;
    },
    private readonly deps: { reader: ClusterIdentityReader; health: ProviderHealthStore; logger: Logger },
  ) {}

  get expectedGenesisHash(): string | null {
    return expectedGenesisHash(this.config.cluster, this.config.localnetGenesisHash);
  }

  isVerified(): boolean {
    return this.state.verified;
  }

  async verify(): Promise<boolean> {
    try {
      const identity = await this.deps.reader.read();
      const outcome = evaluateClusterIdentity(
        this.config.cluster,
        this.expectedGenesisHash,
        identity.genesisHash,
      );
      this.state = {
        observedGenesisHash: identity.genesisHash,
        verified: outcome.verified,
        verifiedAt: outcome.verified ? identity.checkedAt : null,
        checkedAt: identity.checkedAt,
        solanaCoreVersion: identity.solanaCoreVersion,
        failureReason: outcome.failureReason,
      };
      await this.deps.health.setVerificationFailure(this.config.providerId, outcome.failureReason);
      if (outcome.mainnetDetected) {
        this.deps.logger.fatal(
          { cluster: this.config.cluster, observedGenesisHash: identity.genesisHash },
          "CRITICAL: the configured RPC serves Solana Mainnet. All Solana operations are disabled.",
        );
      } else if (!outcome.verified) {
        this.deps.logger.error({ reason: outcome.failureReason }, "Solana cluster verification failed");
      }
    } catch (error) {
      // An unreachable RPC leaves the cluster unverified; it is not a mismatch.
      this.state = {
        ...this.state,
        verified: false,
        verifiedAt: null,
        checkedAt: new Date(),
        failureReason: isProviderError(error)
          ? `RPC ${error.kind.toLowerCase()}: ${error.message}`
          : "RPC unreachable",
      };
      this.deps.logger.warn(
        { reason: this.state.failureReason },
        "Solana cluster verification could not complete",
      );
    }
    return this.state.verified;
  }

  /** Verifies now and keeps re-verifying: every 5 minutes when verified, every 30 seconds otherwise. */
  start(): void {
    const loop = async () => {
      const verified = await this.verify();
      this.timer = setTimeout(loop, verified ? VERIFIED_RECHECK_INTERVAL_MS : UNVERIFIED_RECHECK_INTERVAL_MS);
      this.timer.unref();
    };
    void loop();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  identity(rpcProvider: string): NetworkIdentity {
    const iso = (value: Date | null) => (value ? value.toISOString() : null);
    return {
      cluster: this.config.cluster,
      networkLabel: networkLabel(this.config.cluster),
      expectedGenesisHash: this.expectedGenesisHash,
      observedGenesisHash: this.state.observedGenesisHash,
      verified: this.state.verified,
      verifiedAt: iso(this.state.verifiedAt),
      checkedAt: iso(this.state.checkedAt),
      rpcProvider,
      solanaCoreVersion: this.state.solanaCoreVersion,
      failureReason: this.state.failureReason,
    };
  }
}
