import { and, eq, schema, type Database } from "@sct/database";
import type { Cluster } from "@sct/network";
import type { IdentityStore, Transaction } from "../application/ports";

export class IdentityRepository implements IdentityStore {
  async findOrCreateUserByWallet(address: string, cluster: Cluster, at: Date, transaction: Transaction) {
    const tx = transaction as Database;
    const identity = schema.userWalletIdentities;
    const [existing] = await tx
      .select({ userId: identity.userId, identityId: identity.id, displayName: schema.users.displayName })
      .from(identity)
      .innerJoin(schema.users, eq(schema.users.id, identity.userId))
      .where(and(eq(identity.address, address), eq(identity.cluster, cluster)));

    if (existing) {
      await tx.update(identity).set({ lastSeenAt: at }).where(eq(identity.id, existing.identityId));
      return { userId: existing.userId, displayName: existing.displayName, created: false };
    }

    const [user] = await tx.insert(schema.users).values({}).returning({ id: schema.users.id });
    if (!user) throw new Error("Failed to create user");
    await tx.insert(identity).values({ userId: user.id, address, cluster, firstSeenAt: at, lastSeenAt: at });
    return { userId: user.id, displayName: null, created: true };
  }
}
