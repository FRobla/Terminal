import { eq, schema, type Database } from "@sct/database";
import type { Transaction } from "../../auth/application/ports";
import type { OwnershipChallengeStore } from "../application/registry-ports";
import type { OwnershipChallenge } from "../domain/ownership-challenge";

export class OwnershipChallengeRepository implements OwnershipChallengeStore {
  constructor(private readonly db: Database) {}

  async create(
    challenge: Omit<OwnershipChallenge, "id" | "consumedAt"> & { nonce: string; issuedAt: Date },
  ): Promise<string> {
    const [row] = await this.db
      .insert(schema.walletOwnershipChallenges)
      .values(challenge)
      .returning({ id: schema.walletOwnershipChallenges.id });
    if (!row) throw new Error("Failed to persist the ownership challenge");
    return row.id;
  }

  async lock(challengeId: string, transaction: Transaction): Promise<OwnershipChallenge | null> {
    const [row] = await (transaction as Database)
      .select()
      .from(schema.walletOwnershipChallenges)
      .where(eq(schema.walletOwnershipChallenges.id, challengeId))
      .for("update");
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      address: row.address,
      cluster: row.cluster,
      message: row.message,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  async markConsumed(challengeId: string, at: Date, transaction: Transaction): Promise<void> {
    await (transaction as Database)
      .update(schema.walletOwnershipChallenges)
      .set({ consumedAt: at })
      .where(eq(schema.walletOwnershipChallenges.id, challengeId));
  }
}
