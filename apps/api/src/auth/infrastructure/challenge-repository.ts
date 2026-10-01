import { eq, schema, type Database } from "@sct/database";
import type { ChallengeStore, StoredChallenge, Transaction } from "../application/ports";

export class ChallengeRepository implements ChallengeStore {
  constructor(private readonly db: Database) {}

  async create(
    challenge: Omit<StoredChallenge, "id" | "consumedAt"> & { requesterIp: string | null },
  ): Promise<string> {
    const [row] = await this.db
      .insert(schema.authChallenges)
      .values(challenge)
      .returning({ id: schema.authChallenges.id });
    if (!row) throw new Error("Failed to persist sign-in challenge");
    return row.id;
  }

  async lockById(id: string, transaction: Transaction): Promise<StoredChallenge | null> {
    const tx = transaction as Database;
    const [row] = await tx
      .select()
      .from(schema.authChallenges)
      .where(eq(schema.authChallenges.id, id))
      .for("update");
    if (!row) return null;
    return {
      id: row.id,
      address: row.address,
      cluster: row.cluster,
      nonce: row.nonce,
      message: row.message,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  async markConsumed(id: string, at: Date, transaction: Transaction): Promise<void> {
    const tx = transaction as Database;
    await tx.update(schema.authChallenges).set({ consumedAt: at }).where(eq(schema.authChallenges.id, id));
  }
}
