/**
 * ui-next setup + login — real kernel + real SPA: claim, then login success/failure.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPERATOR_EMAIL = "smoke@example.com";
const OPERATOR_NAME = "Smoke Ops";
const OPERATOR_PASSWORD = "Password1234!";

test("ui-next claim succeeds and already-claimed path closes setup", async ({ page, request }) => {
  const claimPath = join(dirname(fileURLToPath(import.meta.url)), ".claim-code-ui-next");
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

  await expect(
    page.getByText(`First operator created. Signed in as ${OPERATOR_NAME}`),
  ).toBeVisible({
    timeout: 15_000,
  });

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
  const reopenBody = (await reopen.json()) as {
    error: { code: string; data?: { reason?: string } };
  };
  expect(reopenBody.error.code).toBe("SetupClosed");
  expect(reopenBody.error.data?.reason).toBe("first_operator_exists");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("Setup is closed. Sign in with an existing operator account."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create admin account" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("ui-next login rejects wrong password then succeeds with claim credentials", async ({
  page,
  request,
}) => {
  const status = await request.get("/console/setup/status");
  expect(status.ok()).toBeTruthy();
  const statusBody = (await status.json()) as {
    data: { setupClosed: boolean; claimRequired: boolean };
  };
  expect(statusBody.data.setupClosed).toBe(true);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });

  await page.evaluate(() => sessionStorage.removeItem("oke_console_at"));

  await page.locator("#email").fill(OPERATOR_EMAIL);
  await page.locator("#password").fill("WrongPassword999!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toContainText("Authentication failed.", {
    timeout: 15_000,
  });
  const failedToken = await page.evaluate(() => sessionStorage.getItem("oke_console_at"));
  expect(failedToken).toBeNull();

  await page.locator("#password").fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByText(`Signed in as ${OPERATOR_NAME} (${OPERATOR_EMAIL})`),
  ).toBeVisible({
    timeout: 15_000,
  });

  const token = await page.evaluate(() => sessionStorage.getItem("oke_console_at"));
  expect(token).toBeTruthy();
});

test("ui-next theme toggle flips .dark and persists across reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "OKE" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();

  await page.getByRole("button", { name: "Dark" }).click();

  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("oke-console-theme")))
    .toBe("dark");

  await page.reload();
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("oke-console-theme")))
    .toBe("dark");

  await page.getByRole("button", { name: "Light" }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(false);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("oke-console-theme")))
    .toBe("light");
});
