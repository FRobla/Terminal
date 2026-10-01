import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? "postgresql://localhost:5432/solana_terminal",
  },
  strict: true,
  verbose: true,
});
