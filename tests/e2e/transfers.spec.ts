import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { query, signInWithRole, withTestWallet } from "./support";

async function expectNoSeriousViolations(page: Page) {
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious, JSON.stringify(serious.map((violation) => violation.id))).toEqual([]);
}

const DESTINATION = "SysvarRent111111111111111111111111111111111";

/**
 * The e2e wallet is a fresh, unfunded Devnet account (the faucet is not used in e2e), so a real
 * simulation fails. Successful signing and submission are covered by API integration tests and
 * the manual verification guide.
 */
test.describe("SOL transfers", () => {
  test("TXL-AC-02/03/11: a transfer from an unfunded wallet is simulated on Devnet, reviewed, and cannot be signed", async ({
    page,
  }) => {
    await withTestWallet(page);
    await signInWithRole(page, "operator");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Wallets" }).click();
    await page.getByRole("button", { name: "Register connected wallet" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Unfunded hot wallet");
    await page.getByRole("button", { name: "Sign and register" }).click();
    await expect(page.getByRole("heading", { name: "Unfunded hot wallet" })).toBeVisible();

    await page.getByRole("button", { name: "Transfer SOL" }).click();
    await page.getByLabel("Destination address").fill("not an address");
    await page.getByLabel("Amount (SOL)").fill("0.001");
    await page.getByRole("button", { name: "Review transfer" }).click();
    await expect(page.getByText("Enter a valid base58 Solana address.")).toBeVisible();

    await page.getByLabel("Destination address").fill(DESTINATION);
    await page.getByRole("button", { name: "Review transfer" }).click();
    await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /Transfer 0\.001000000 SOL/ })).toBeVisible();
    await expect(page.getByText("Simulation failed").first()).toBeVisible();
    await expect(page.getByText("System Program")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign and submit" })).toHaveCount(0);
    await expect(page.getByLabel("Transaction state history")).toContainText("Prepared");
    await expectNoSeriousViolations(page);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Transactions" })
      .click();
    await expect(page.getByRole("row", { name: /Unfunded hot wallet/ })).toContainText("Simulation failed");
  });

  test("TXL-AC-10: a viewer sees no Transfer SOL action @responsive", async ({ page }) => {
    await withTestWallet(page);
    const address = await signInWithRole(page, "viewer");
    // A controlled wallet the viewer created and is assigned to, inserted directly: viewers cannot register wallets.
    const [wallet] = await query<{ id: string }>(
      `INSERT INTO managed_wallets (id, organization_id, address, cluster, label, category, custody_type, created_by_user_id)
       SELECT gen_random_uuid(), o.id, $1, 'devnet', 'Viewer wallet', 'TREASURY', 'BROWSER_WALLET', i.user_id
       FROM organizations o, user_wallet_identities i WHERE o.slug = 'default' AND i.address = $1
       RETURNING id`,
      [address],
    );
    await query(`INSERT INTO wallet_sync_state (wallet_id) VALUES ($1)`, [wallet!.id]);
    await query(
      `INSERT INTO wallet_assignments (wallet_id, user_id, role) SELECT $1, user_id, 'CREATOR' FROM user_wallet_identities WHERE address = $2`,
      [wallet!.id, address],
    );
    await page.goto(`/wallets/${wallet!.id}`);
    await expect(page.getByRole("heading", { name: "Viewer wallet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Transfer SOL" })).toHaveCount(0);
    await page.goto("/transactions");
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  });
});
