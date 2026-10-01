import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { getAddressEncoder, type Address } from "@solana/kit";
import { expect, test, type Page, type Request } from "@playwright/test";
import { query, signInWithRole, withTestWallet } from "./support";

const PASSPHRASE = "e2e local wallet passphrase";

async function expectNoSeriousViolations(page: Page) {
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious, JSON.stringify(serious.map((violation) => violation.id))).toEqual([]);
}

/** Every request body the page sends, for the "no key material leaves the browser" checks. */
function recordRequestBodies(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request: Request) => {
    bodies.push(`${request.url()}\n${request.postData() ?? ""}`);
  });
  return bodies;
}

/** The stored record's secret-bearing fields as they would appear if serialized (arrays and base64). */
async function storedRecordFragments(page: Page, address: string): Promise<string[]> {
  return page.evaluate(async (target) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("sct-local-wallets", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{
      ciphertext: Uint8Array;
      kdf: { salt: Uint8Array };
      cipher: { iv: Uint8Array };
    }>((resolve, reject) => {
      const request = database.transaction("keys").objectStore("keys").get(target);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    return [record.ciphertext, record.kdf.salt, record.cipher.iv].flatMap((bytes) => [
      Array.from(bytes).join(","),
      base64(bytes),
    ]);
  }, address);
}

async function createLocalWallet(page: Page, label: string) {
  await page.goto("/wallets");
  await page.getByRole("button", { name: "Create local wallet" }).click();
  await page.getByLabel("I understand that only I can recover this wallet.").check();
  await page.getByLabel("Label", { exact: true }).fill(label);
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await page.getByLabel("Confirm passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Create and register" }).click();
}

test.describe("local wallets", () => {
  test("LWG-AC-02/06/07/09: creates, registers, exports, and removes a local wallet without sending key material", async ({
    page,
  }) => {
    await withTestWallet(page);
    await signInWithRole(page, "operator");
    const bodies = recordRequestBodies(page);

    await page.goto("/wallets");
    await page.getByRole("button", { name: "Create local wallet" }).click();
    await expect(page.getByText(/not institutional custody/)).toBeVisible();
    await page.getByLabel("Label", { exact: true }).fill("Local dev wallet");
    await page.getByLabel("Passphrase", { exact: true }).fill("too short");
    await page.getByLabel("Confirm passphrase").fill("too short");
    await page.getByLabel("I understand that only I can recover this wallet.").check();
    await page.getByRole("button", { name: "Create and register" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await expectNoSeriousViolations(page);

    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await page.getByLabel("Confirm passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Create and register" }).click();

    await expect(page).toHaveURL(/\/wallets\/[0-9a-f-]{36}\?created=local$/);
    await expect(page.getByText("Key on this device", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Wallet created. Export the recovery file now and store it offline."),
    ).toBeVisible();
    const walletId = page.url().split("/wallets/")[1]!.split("?")[0]!;
    const [registered] = await query<{ address: string; custody_type: string }>(
      "SELECT address, custody_type FROM managed_wallets WHERE id = $1",
      [walletId],
    );
    expect(registered?.custody_type).toBe("LOCAL_ENCRYPTED");
    const address = registered!.address;

    // Export: the API audits first, then the browser decrypts and downloads.
    await page.getByRole("button", { name: "Export recovery material" }).click();
    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await page.getByLabel('Type "Local dev wallet" to confirm').fill("Local dev wallet");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download recovery file" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^Local-dev-wallet-.{8}-devnet\.json$/);
    const secret = JSON.parse(await readFile((await download.path())!, "utf8")) as number[];
    expect(secret).toHaveLength(64);
    expect(secret.slice(32)).toEqual(Array.from(getAddressEncoder().encode(address as Address)));
    await expect(page.getByText("Recovery file downloaded. Store it offline.")).toBeVisible();
    const exported = await query(
      "SELECT 1 FROM audit_events WHERE action = 'wallet.exported' AND resource_id = $1",
      [walletId],
    );
    expect(exported).toHaveLength(1);

    // LWG-AC-02: nothing secret left the browser.
    const fragments = await storedRecordFragments(page, address);
    const secretText = secret.join(",");
    for (const body of bodies) {
      expect(body).not.toContain(PASSPHRASE);
      expect(body).not.toContain(secretText);
      for (const fragment of fragments) expect(body).not.toContain(fragment);
    }

    // LWG-AC-06: the registry marks the key as present on this device.
    await page.goto("/wallets");
    await expect(page.getByRole("row", { name: /Local dev wallet/ })).toContainText("Key on this device");

    // LWG-AC-09: removal deletes only the browser copy.
    await page.goto(`/wallets/${walletId}`);
    await page.getByRole("button", { name: "Remove from this device" }).click();
    await page.getByLabel("I exported the recovery file or accept losing this wallet.").check();
    await page.getByLabel('Type "Local dev wallet" to confirm').fill("Local dev wallet");
    await page.getByRole("button", { name: "Remove key from this device" }).click();
    await expect(page.getByText("Key not on this device", { exact: true })).toBeVisible();
    expect(await query("SELECT 1 FROM managed_wallets WHERE id = $1", [walletId])).toHaveLength(1);
  });

  test("LWG-AC-08: a key whose registration failed stays on the device and can be registered later", async ({
    page,
  }) => {
    await withTestWallet(page);
    await signInWithRole(page, "operator");
    await page.route("**/api/v1/wallets", (route) =>
      route.request().method() === "POST" ? route.abort("failed") : route.continue(),
    );
    await createLocalWallet(page, "Orphan key");
    await expect(page.getByText(/is stored in this browser/)).toBeVisible();
    await page.unroute("**/api/v1/wallets");

    await page.goto("/wallets");
    await expect(page.getByText("Keys on this device not registered")).toBeVisible();
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await page.getByLabel("Label", { exact: true }).last().fill("Recovered orphan");
    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await page.getByRole("button", { name: "Register this key" }).click();
    await expect(page.getByRole("heading", { name: "Recovered orphan" })).toBeVisible();
    await expect(page.getByText("Key on this device", { exact: true })).toBeVisible();
  });
});
