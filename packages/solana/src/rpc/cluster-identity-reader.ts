import { z } from "zod";
import type { SolanaRpcClient } from "./solana-rpc-client";

export interface ClusterIdentityReading {
  genesisHash: string;
  solanaCoreVersion: string | null;
  checkedAt: Date;
}

const genesisHashSchema = z.string().min(32).max(44);
const versionSchema = z.object({ "solana-core": z.string() }).loose();

/** Reads the RPC's cluster identity for genesis-hash verification (SPEC-005). */
export class ClusterIdentityReader {
  constructor(private readonly client: SolanaRpcClient) {}

  async read(): Promise<ClusterIdentityReading> {
    const genesis = await this.client.call("getGenesisHash", (abortSignal) =>
      this.client.rpc
        .getGenesisHash()
        .send({ abortSignal })
        .then((value) => genesisHashSchema.parse(value)),
    );
    let solanaCoreVersion: string | null = null;
    try {
      const version = await this.client.call("getVersion", (abortSignal) =>
        this.client.rpc
          .getVersion()
          .send({ abortSignal })
          .then((value) => versionSchema.parse(value)),
      );
      solanaCoreVersion = version.value["solana-core"];
    } catch {
      // The version is informational; verification depends only on the genesis hash.
    }
    return { genesisHash: genesis.value, solanaCoreVersion, checkedAt: genesis.retrievedAt };
  }
}
