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

const primaryNavigation = (page: Page) => page.getByRole("navigation", { name: "Primary" });

// The Devnet system program id: a valid address that is never a test wallet.
const WATCHED_ADDRESS = "SysvarRent111111111111111111111111111111111";

test.describe("wallet registry", () => {
  test("WRG-AC-05/15: an operator registers the connected wallet with an ownership signature", async ({
    page,
  }) => {
    await withTestWallet(page);
    const address = await signInWithRole(page, "operator");

    await primaryNavigation(page).getByRole("link", { name: "Wallets" }).click();
    await expect(page).toHaveURL(/\/wallets$/);
    // Signing in does not register the sign-in wallet (other tests share the organization, so filter by address).
    await page.getByPlaceholder("Label or address prefix").fill(address);
    await expect(page.getByText("No wallets match these filters.")).toBeVisible();
    await page.getByPlaceholder("Label or address prefix").fill("");
    await expectNoSeriousViolations(page);

    await page.getByRole("button", { name: "Register connected wallet" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Desk hot wallet");
    await page.getByLabel("Category", { exact: true }).selectOption("TRADING");
    await page.getByLabel("Tags", { exact: true }).fill("desk, e2e");
    await page.getByRole("button", { name: "Sign and register" }).click();

    await expect(page).toHaveURL(/\/wallets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Desk hot wallet" })).toBeVisible();
    await expect(page.getByText(address).first()).toBeVisible();
    await expect(page.getByTestId("sol-balance")).toBeVisible();
    await expect(page.getByText("Creator", { exact: true })).toBeVisible();
    await expectNoSeriousViolations(page);

    const [created] = await query<{ custody_type: string; category: string }>(
      "SELECT custody_type, category FROM managed_wallets WHERE address = $1",
      [address],
    );
    expect(created).toEqual({ custody_type: "BROWSER_WALLET", category: "TRADING" });

    await page.getByRole("link", { name: "Wallets", exact: true }).first().click();
    const row = page.getByRole("row", { name: /Desk hot wallet/ });
    await expect(row).toContainText("Trading");
    await expect(row).toContainText("Browser wallet");
    await expect(row).toContainText("SOL");
  });

  test("WRG-AC-01/08/15: adds a watch-only address, edits it, and archives it @responsive", async ({
    page,
  }) => {
    await withTestWallet(page);
    await signInWithRole(page, "operator");
    await query(
      "DELETE FROM wallet_sync_state WHERE wallet_id IN (SELECT id FROM managed_wallets WHERE address = $1)",
      [WATCHED_ADDRESS],
    );
    await query(
      "DELETE FROM wallet_assignments WHERE wallet_id IN (SELECT id FROM managed_wallets WHERE address = $1)",
      [WATCHED_ADDRESS],
    );
    await query(
      "DELETE FROM wallet_tags WHERE wallet_id IN (SELECT id FROM managed_wallets WHERE address = $1)",
      [WATCHED_ADDRESS],
    );
    await query("DELETE FROM managed_wallets WHERE address = $1", [WATCHED_ADDRESS]);

    await page.goto("/wallets");
    await page.getByRole("button", { name: "Add watch-only address" }).click();
    await page.getByLabel("Address").fill("not an address");
    await page.getByLabel("Label", { exact: true }).fill("Rent sysvar");
    await page.getByRole("button", { name: "Add watch-only address" }).last().click();
    await expect(page.getByText("Enter a valid base58 Solana address.")).toBeVisible();

    await page.getByLabel("Address").fill(WATCHED_ADDRESS);
    await page.getByRole("button", { name: "Add watch-only address" }).last().click();
    await expect(page.getByRole("heading", { name: "Rent sysvar" })).toBeVisible();
    await expect(page.getByText("Watch-only").locator("visible=true").first()).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Rent sysvar (watched)");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Rent sysvar (watched)" })).toBeVisible();

    await page.getByRole("button", { name: "Archive wallet" }).click();
    await page.getByRole("button", { name: "Confirm archive wallet" }).click();
    await expect(page.getByRole("button", { name: "Restore wallet" })).toBeVisible();

    await page.goto("/wallets");
    await expect(page.getByText("Rent sysvar (watched)")).toHaveCount(0);
    await page.getByLabel("Status filter").selectOption("archived");
    await expect(page.getByText("Rent sysvar (watched)").locator("visible=true").first()).toBeVisible();
  });
});
