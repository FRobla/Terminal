import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  connectAndSignIn,
  query,
  signInWithRole,
  testWalletAddress,
  withTestWallet,
  expectAfterDevnetRateLimit,
} from "./support";

test.describe("shell", () => {
  test("NET-AC-05: the Devnet indicator is always visible @responsive", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("network-indicator")).toHaveText("SOLANA DEVNET");
    await expect(page.getByTestId("network-indicator")).toBeInViewport();
    await page.goto("/system");
    await expect(page.getByTestId("network-indicator")).toBeVisible();
  });

  test("SECURITY §8: pages are served with a nonce-based CSP and hardening headers", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["x-powered-by"]).toBeUndefined();
  });

  test("NET-AC-02: the system view shows the verified Devnet genesis hash from the real RPC", async ({
    page,
  }) => {
    await page.goto("/system");
    await expect(page.getByText("Yes — genesis hash matches")).toBeVisible();
    await expect(page.getByText("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG").first()).toBeVisible();
  });
});

test.describe("wallet discovery", () => {
  test("WO-AC-01: without a Devnet-capable wallet the empty state explains what to do", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/No Solana wallet supporting Devnet was detected/)).toBeVisible();
  });

  test("WO-AC-01: a wallet that does not support Devnet is not offered", async ({ page }) => {
    await withTestWallet(page, { walletChains: ["solana:mainnet"] });
    await page.goto("/");
    await expect(page.getByText(/No Solana wallet supporting Devnet was detected/)).toBeVisible();
  });

  test("WO-AC-15: an account without solana:devnet is blocked", async ({ page }) => {
    await withTestWallet(page, { walletChains: ["solana:devnet"], accountChains: ["solana:mainnet"] });
    await page.goto("/");
    await page
      .getByRole("banner")
      .getByRole("button", { name: /Connect SCT Test Wallet/ })
      .click();
    await expect(page.getByText("This wallet account is not configured for Solana Devnet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with this wallet" })).toHaveCount(0);
  });
});

test.describe("sign-in and overview against Devnet", () => {
  test("AUTH-AC-02 / RBAC-AC-03: signing in via solana:signIn without membership shows a permission message", async ({
    page,
  }) => {
    await withTestWallet(page, { supportSignIn: true });
    await connectAndSignIn(page);
    await expect(page.getByText(/not a member of any organization/)).toBeVisible();
  });

  test("AUTH-AC-07: the status bar connect button connects and signs in in one action", async ({ page }) => {
    await withTestWallet(page);
    await page.goto("/system");
    await page.getByRole("banner").getByRole("button", { name: "Connect SCT Test Wallet" }).click();
    await expect(page.getByText("No organization")).toBeVisible();
    await expect(page.getByText("Signed out")).toHaveCount(0);
  });

  test("AUTH-AC-07: without a Devnet wallet the status bar explains why sign-in is unavailable", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("No Devnet wallet detected.")).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button")).toHaveCount(0);
  });

  test("AUTH-AC-02: the signMessage fallback also signs in", async ({ page }) => {
    await withTestWallet(page, { supportSignIn: false });
    await connectAndSignIn(page);
    await expect(page.getByText("No organization")).toBeVisible();
  });

  test("WO-AC-02/03/06/07/09/10: a fresh Devnet account shows real zero balance, empty sections, provenance, and freshness", async ({
    page,
  }) => {
    await withTestWallet(page);
    const address = await signInWithRole(page, "viewer");

    await expect(page.getByTestId("sol-balance")).toHaveText(/0\.000000000\s*SOL/);
    await expect(page.getByText("No token accounts found for this wallet on Devnet.")).toBeVisible();
    await expect(page.getByText("No indexed transactions are available for this wallet.")).toBeVisible();
    await expect(page.getByText(/Updated \d+ s ago/).first()).toBeVisible();

    await page.getByRole("button", { name: "Show data source for SOL balance" }).click();
    const provenance = page.getByRole("dialog");
    await expect(provenance).toContainText("getBalance");
    await expect(provenance).toContainText("https://api.devnet.solana.com");
    await expect(provenance).toContainText("AUTHORITATIVE");
    await page.keyboard.press("Escape");

    const events = await query<{ metadata: { walletName: string } }>(
      "SELECT metadata FROM audit_events WHERE action = 'wallet.connected' AND resource_id = $1",
      [address],
    );
    expect(events[0]?.metadata.walletName).toBe("SCT Test Wallet");

    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious.map((violation) => violation.id))).toEqual([]);
  });

  test("WO-AC-11/12: unavailable sections render DATA UNAVAILABLE with reason, source, and retry", async ({
    page,
  }) => {
    await withTestWallet(page);
    await signInWithRole(page, "viewer");
    // Test-only interception to render a rate-limit payload; the API behavior itself is covered by integration tests.
    await page.route("**/api/v1/wallets/*/overview*", async (route) => {
      const upstream = await route.fetch();
      const body = await upstream.json();
      body.data.solBalance = {
        status: "UNAVAILABLE",
        value: null,
        provenance: null,
        unavailable: {
          reason: "RPC_RATE_LIMITED",
          message: "The Solana RPC rate limit was reached.",
          source: "solana-rpc-devnet",
          lastSuccessfulRetrievalAt: null,
          retry: { retryable: true, retryAfterMs: 10000, attempts: 1 },
        },
      };
      await route.fulfill({ response: upstream, json: body });
    });
    await page.getByRole("button", { name: /Refresh/ }).click();
    const unavailable = page.getByRole("status").filter({ hasText: "DATA UNAVAILABLE" });
    await expect(unavailable).toContainText("RPC rate limited");
    await expect(unavailable).toContainText("solana-rpc-devnet");
    await expect(unavailable).toContainText("Never");
    await expect(unavailable.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("WO-AC-17: memos are rendered as inert text", async ({ page }) => {
    await withTestWallet(page);
    await signInWithRole(page, "viewer");
    await page.route("**/api/v1/wallets/*/overview*", async (route) => {
      const upstream = await route.fetch();
      const body = await upstream.json();
      const retrievedAt = new Date().toISOString();
      body.data.recentTransactions = {
        status: "AVAILABLE",
        value: [
          {
            signature:
              "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
            slot: "1",
            blockTime: null,
            status: "succeeded",
            confirmationStatus: "finalized",
            memo: '<img src=x onerror="window.__pwned=1">',
            explorerUrl: "https://explorer.solana.com/tx/x?cluster=devnet",
          },
        ],
        provenance: { ...body.data.solBalance.provenance, method: "getSignaturesForAddress", retrievedAt },
      };
      await route.fulfill({ response: upstream, json: body });
    });
    await page.getByRole("button", { name: /Refresh/ }).click();
    await expect(page.getByText('<img src=x onerror="window.__pwned=1">').first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("WO-AC-14: disconnecting the wallet removes its data", async ({ page }) => {
    await withTestWallet(page);
    await signInWithRole(page, "viewer");
    await expect(page.getByTestId("sol-balance")).toBeVisible();
    await page.getByRole("button", { name: "Disconnect wallet" }).click();
    await expect(page.getByTestId("sol-balance")).toHaveCount(0);
  });

  test("watch view validates addresses before requesting data", async ({ page }) => {
    await withTestWallet(page);
    await signInWithRole(page, "viewer");
    await page.keyboard.press("/");
    await page.keyboard.type("not-an-address");
    await page.getByRole("button", { name: "View" }).click();
    await expect(page.getByText("Enter a valid base58 Solana address.")).toBeVisible();
    const own = await testWalletAddress(page);
    await page.getByLabel(/View the overview of any Devnet address/).fill(own);
    await page.getByRole("button", { name: "View" }).click();
    await expect(page.getByText("Watching")).toBeVisible();
  });
});
