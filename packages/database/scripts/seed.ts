import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_DESCRIPTIONS, PERMISSIONS, SYSTEM_ROLES } from "@sct/validation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/schema";

export const DEFAULT_ORGANIZATION_SLUG = "default";

/**
 * Seeds reference data only: the permission catalog, system roles, and one
 * default organization. Never seeds financial or blockchain data. Idempotent.
 */
export async function seedReferenceData(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  try {
    await db.transaction(async (tx) => {
      for (const key of PERMISSIONS) {
        await tx
          .insert(schema.permissions)
          .values({ key, description: PERMISSION_DESCRIPTIONS[key] })
          .onConflictDoUpdate({
            target: schema.permissions.key,
            set: { description: PERMISSION_DESCRIPTIONS[key] },
          });
      }

      for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
        const existing = await tx
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(and(isNull(schema.roles.organizationId), eq(schema.roles.key, key)));
        const roleId =
          existing[0]?.id ??
          (
            await tx
              .insert(schema.roles)
              .values({ key, name: role.name, isSystem: true, organizationId: null })
              .returning({ id: schema.roles.id })
          )[0]?.id;
        if (!roleId) throw new Error(`Could not create system role ${key}`);

        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
        await tx
          .insert(schema.rolePermissions)
          .values(role.permissions.map((permissionKey) => ({ roleId, permissionKey })));
      }

      await tx
        .insert(schema.organizations)
        .values({ slug: DEFAULT_ORGANIZATION_SLUG, name: "Default Organization" })
        .onConflictDoNothing({ target: schema.organizations.slug });
    });
    await db.execute(sql`select 1`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error("DATABASE_MIGRATION_URL is required to seed reference data.");
    process.exit(1);
  }
  seedReferenceData(url)
    .then(() => console.warn("Reference data seeded."))
    .catch((error: unknown) => {
      console.error("Seeding failed:", error instanceof Error ? error.message : "unknown error");
      process.exit(1);
    });
}
