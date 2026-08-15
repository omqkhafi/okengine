/**
 * Console Playwright smoke — claim → login → shell → each module.
 * Hits `serveConsole`'s default staticDir (`ui-next/dist`) on :6533.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPERATOR_EMAIL = "smoke@example.com";
const OPERATOR_NAME = "Smoke Ops";
const OPERATOR_PASSWORD = "Password1234!";

/**
 * Assert the authenticated shell chrome is visible.
 *
 * @param page - Playwright page
 */
async function expectShell(page: import("@playwright/test").Page): Promise<void> {
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 15_000 });
  await expect(sidebar.getByRole("link", { name: "Flows" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Units" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Store" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Vault" })).toBeVisible();
}

test("claim succeeds, login restores the shell, and each module loads", async ({
  page,
  request,
}) => {
  const claimPath = join(dirname(fileURLToPath(import.meta.url)), ".claim-code");
  const claimCode = readFileSync(claimPath, "utf8").trim();
  expect(claimCode.length).toBeGreaterThan(0);

  const status = await request.get("/console/setup/status");
  expect(status.ok()).toBeTruthy();
  const statusBody = (await status.json()) as {
    data: { setupClosed: boolean; claimRequired: boolean };
  };
  expect(statusBody.data.setupClosed).toBe(false);
  expect(statusBody.data.claimRequired).toBe(true);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "First admin" })).toBeVisible();

  await page.locator("#claimCode").fill(claimCode);
  await page.locator("#name").fill(OPERATOR_NAME);
  await page.locator("#email").fill(OPERATOR_EMAIL);
  await page.locator("#password").fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Create admin account" }).click();

  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });
  await expectShell(page);
  await expect(page.locator('[data-slot="flows-page"]')).toBeVisible();
  await expect(page.locator('[data-slot="flow-graph"]')).toBeVisible();

  const token = await page.evaluate(() => sessionStorage.getItem("oke_console_at"));
  expect(token).toBeTruthy();

  const closed = await request.get("/console/setup/status");
  const closedBody = (await closed.json()) as {
    data: { setupClosed: boolean; claimRequired: boolean };
  };
  expect(closedBody.data.setupClosed).toBe(true);
  expect(closedBody.data.claimRequired).toBe(false);

  const reopen = await request.post("/console/setup/claim", {
    data: {
      claimCode,
      email: "other@example.com",
      name: "Other",
      password: OPERATOR_PASSWORD,
    },
  });
  expect(reopen.status()).toBe(400);
  const reopenBody = (await reopen.json()) as { error: { code: string } };
  expect(reopenBody.error.code).toBe("SetupClosed");

  await page.goto("/units");
  await expect(page).toHaveURL(/\/units/);
  await expect(page.locator('[data-slot="units-page"]')).toBeVisible({ timeout: 15_000 });

  await page.goto("/store");
  await expect(page).toHaveURL(/\/store/);
  await expect(page.locator('[data-slot="store-page"]')).toBeVisible({ timeout: 15_000 });

  await page.goto("/vault");
  await expect(page).toHaveURL(/\/vault/);
  await expect(page.locator('[data-slot="vault-page"]')).toBeVisible({ timeout: 15_000 });

  await page.goto("/overview");
  await expect(page).toHaveURL(/\/flows/);
  await expect(page.locator('[data-slot="flows-page"]')).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => sessionStorage.removeItem("oke_console_at"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Create admin account" })).toHaveCount(0);

  await page.locator("#email").fill(OPERATOR_EMAIL);
  await page.locator("#password").fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });
  await expectShell(page);
  await expect(page.locator('[data-slot="flows-page"]')).toBeVisible();
});
