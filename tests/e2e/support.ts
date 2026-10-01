import { integrationEnvironment } from "@sct/testing";
import { installTestWallet, type TestWalletOptions } from "@sct/testing/test-wallet";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

/** Test-only helpers. Role grants go straight to the test database (there is no admin UI until Iteration 08). */

export async function withTestWallet(page: Page, options: Partial<TestWalletOptions> = {}) {
  await page.addInitScript(installTestWallet, {
    name: "SCT Test Wallet",
    walletChains: ["solana:devnet"],
    supportSignIn: true,
    ...options,
  });
}

export async function testWalletAddress(page: Page): Promise<string> {
  return page.evaluate(() =>
    (
      window as unknown as { __SCT_TEST_WALLET__: { address: () => Promise<string> } }
    ).__SCT_TEST_WALLET__.address(),
  );
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
  try {
    return (await client.unsafe(sql, params as never[])) as unknown as T[];
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function grantRoleToWallet(address: string, roleKey: string): Promise<void> {
  const [membership] = await query<{ id: string; organization_id: string; user_id: string }>(
    `INSERT INTO organization_memberships (id, organization_id, user_id)
     SELECT gen_random_uuid(), o.id, i.user_id
     FROM organizations o, user_wallet_identities i
     WHERE o.slug = 'default' AND i.address = $1 AND i.cluster = 'devnet'
     ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active'
     RETURNING id, organization_id, user_id`,
    [address],
  );
  if (!membership) throw new Error(`No user for wallet ${address}; sign in first.`);
  await query(
    `INSERT INTO membership_roles (membership_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.organization_id IS NULL AND r.key = $2 ON CONFLICT DO NOTHING`,
    [membership.id, roleKey],
  );
  await query(`UPDATE sessions SET active_organization_id = $1 WHERE user_id = $2`, [
    membership.organization_id,
    membership.user_id,
  ]);
}

/** Connects the injected test wallet from the status bar, which also signs in. Returns the wallet address. */
export async function connectAndSignIn(page: Page): Promise<string> {
  await page.goto("/");
  await page
    .getByRole("banner")
    .getByRole("button", { name: /Connect SCT Test Wallet/ })
    .click();
  await expect(page.getByText("Signed out")).toHaveCount(0);
  return testWalletAddress(page);
}

/** Permissions are cached for up to 60 s per API process; a fresh sign-in picks up new roles immediately. */
export async function signInWithRole(page: Page, roleKey: string): Promise<string> {
  const address = await connectAndSignIn(page);
  await grantRoleToWallet(address, roleKey);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Signed out")).toBeVisible();
  await page.getByRole("button", { name: "Sign in with this wallet" }).click();
  await expect(page.getByText("Default Organization")).toBeVisible();
  return address;
}

/**
 * The public Devnet RPC rate-limits shared runner IPs; the terminal then correctly shows
 * DATA UNAVAILABLE. Like a user, retry with Refresh after the 10 s budget window.
 */
export async function expectAfterDevnetRateLimit(page: Page, assertion: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if ((await page.getByText("RPC rate limited").count()) > 0) {
      await page.getByRole("button", { name: /^Refresh/ }).click();
    }
    await assertion();
  }).toPass({ intervals: [11_000, 11_000, 11_000], timeout: 45_000 });
}
