import setupIntegrationDatabase from "../integration/global-setup";

/** E2E reuses the integration database: migrated, seeded, and with a clean Redis logical database. */
export default async function globalSetup(): Promise<void> {
  await setupIntegrationDatabase();
}
