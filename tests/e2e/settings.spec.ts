import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { connectAndSignIn, query, signInWithRole, withTestWallet } from "./support";

async function expectNoSeriousViolations(page: Page) {
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious, JSON.stringify(serious.map((violation) => violation.id))).toEqual([]);
}

const primaryNavigation = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const settingsNavigation = (page: Page) => page.getByRole("navigation", { name: "Settings" });

test.describe("user settings", () => {
  test("SET-AC-01: signed-out visitors see no Settings entry and are asked to sign in @responsive", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(primaryNavigation(page).getByRole("link", { name: "System" })).toBeVisible();
    await expect(primaryNavigation(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.goto("/settings/profile");
    await expect(page.getByText("Sign in to manage your settings.")).toBeVisible();
  });

  test("SET-AC-01/02/03: a user without membership opens Settings, sees the profile, and sets a display name", async ({
    page,
  }) => {
    await withTestWallet(page);
    const address = await connectAndSignIn(page);
    await primaryNavigation(page).getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByText(/not a member of any organization/)).toBeVisible();
    await expect(page.getByText(address.slice(0, 4)).first()).toBeVisible();
    await expect(settingsNavigation(page).getByRole("link", { name: "Preferences" })).toBeVisible();
    await expect(page.getByText("Owner console")).toHaveCount(0);

    await page.getByLabel("Display name").fill("Treasury Desk");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Treasury Desk" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("SET-AC-04/06: saved preferences change density, explorer links, and shortcuts across the terminal", async ({
    page,
  }) => {
    await withTestWallet(page);
    const address = await signInWithRole(page, "viewer");
    // Client-side navigation keeps the wallet connected for the overview check below.
    await primaryNavigation(page).getByRole("link", { name: "Settings" }).click();
    await settingsNavigation(page).getByRole("link", { name: "Preferences" }).click();
    await page.getByLabel("Density").selectOption("comfortable");
    await page.getByLabel("Block explorer").selectOption("solscan");
    await page.getByLabel("Time zone").selectOption("utc");
    await page.getByLabel("Keyboard shortcuts").uncheck();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
    await expectNoSeriousViolations(page);

    const [stored] = await query<{ preferences: Record<string, unknown> }>(
      `SELECT p.preferences FROM user_preferences p
         JOIN user_wallet_identities i ON i.user_id = p.user_id WHERE i.address = $1`,
      [address],
    );
    expect(stored?.preferences).toMatchObject({
      density: "comfortable",
      explorer: "solscan",
      timeZone: "utc",
    });

    await primaryNavigation(page).getByRole("link", { name: "Wallet overview" }).click();
    await expect(page.getByTestId("sol-balance")).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(`Connected wallet ${address} \\(opens Solscan\\)`) }),
    ).toHaveAttribute("href", `https://solscan.io/account/${address}?cluster=devnet`);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
    await page.locator("body").press("/");
    await expect(page.getByLabel(/View the overview of any Devnet address/)).not.toBeFocused();
  });

  test("SET-AC-07: the sessions page lists the current session", async ({ page }) => {
    await withTestWallet(page);
    await connectAndSignIn(page);
    await page.goto("/settings/sessions");
    await expect(page.getByText("This session", { exact: true })).toBeVisible();
    await expect(page.getByText("This is your only active session.")).toBeVisible();
  });
});

test.describe("owner console", () => {
  test("OWN-AC-01: an administrator has no console navigation and is refused", async ({ page }) => {
    await withTestWallet(page);
    await signInWithRole(page, "admin");
    await page.goto("/settings/profile");
    await expect(settingsNavigation(page).getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(page.getByText("Owner console")).toHaveCount(0);
    await page.goto("/settings/console/overview");
    await expect(
      page.getByText("The owner console is available to the organization owner only."),
    ).toBeVisible();
  });

  test("OWN-AC-02/03/09/12/16: the owner operates the console against live data", async ({ page }) => {
    await withTestWallet(page);
    const address = await signInWithRole(page, "owner");
    await page.goto("/settings/console/overview");
    await expect(page.getByText("Active sessions")).toBeVisible();
    await expect(page.getByText("Solana cluster")).toBeVisible();
    await expectNoSeriousViolations(page);

    await settingsNavigation(page).getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("cell", { name: new RegExp(address.slice(0, 4)) }).first()).toBeVisible();
    await expectNoSeriousViolations(page);

    await settingsNavigation(page).getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("cell", { name: "user.login", exact: true }).first()).toBeVisible();

    await settingsNavigation(page).getByRole("link", { name: "System" }).click();
    await expect(page.getByText("Configuration (non-secret)")).toBeVisible();
    await expect(page.getByText(/applied of \d+ committed/)).toBeVisible();
    await expectNoSeriousViolations(page);

    await settingsNavigation(page).getByRole("link", { name: "Developer" }).click();
    await expect(page.getByRole("cell", { name: "/api/v1/admin/overview" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("OWN-AC-11: a published announcement reaches other users as plain text", async ({ page, browser }) => {
    await withTestWallet(page);
    await signInWithRole(page, "owner");
    try {
      await page.goto("/settings/console/announcement");
      await page.getByLabel("Message").fill("<b>Devnet maintenance</b> tonight at 18:00 UTC.");
      await page.getByLabel("Severity").selectOption("warning");
      await page.getByRole("button", { name: "Publish announcement" }).click();
      await expect(page.getByRole("banner").getByTestId("announcement-banner")).toContainText(
        "<b>Devnet maintenance</b> tonight at 18:00 UTC.",
      );

      const otherContext = await browser.newContext();
      const other = await otherContext.newPage();
      await withTestWallet(other);
      await connectAndSignIn(other);
      await expect(other.getByTestId("announcement-banner")).toContainText("WARNING");
      await expect(other.getByTestId("announcement-banner")).toContainText("<b>Devnet maintenance</b>");
      await otherContext.close();
    } finally {
      await query("DELETE FROM platform_settings WHERE key = 'announcement'");
    }
  });
});
