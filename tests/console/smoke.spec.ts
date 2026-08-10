/**
 * Console Playwright smoke — setup wizard + audited action + reopen denied.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("setup wizard claims first admin, action is traced, wizard cannot reopen", async ({
  page,
  request,
}) => {
  const claimPath = join(dirname(fileURLToPath(import.meta.url)), ".claim-code");
  const claimCode = readFileSync(claimPath, "utf8").trim();
  expect(claimCode.length).toBeGreaterThan(0);

  const status = await request.get("/console/setup/status");
  expect(status.ok()).toBeTruthy();
  const statusBody = (await status.json()) as {
    data: { setupClosed: boolean };
  };
  expect(statusBody.data.setupClosed).toBe(false);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "oke Console" })).toBeVisible();

  await page.getByLabel("Claim code").fill(claimCode);
  await page.getByLabel("Name").fill("Smoke Ops");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByLabel("Password").fill("Password1234!");
  await page.getByRole("button", { name: "Create first operator" }).click();

  await expect(page.getByText(/Signed in as Smoke Ops/)).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Ping (audited)" }).click();
  await expect(page.getByText("console.action.ping").first()).toBeVisible({
    timeout: 10_000,
  });

  const reopen = await request.post("/console/setup/claim", {
    data: {
      claimCode,
      email: "other@example.com",
      name: "Other",
      password: "Password1234!",
    },
  });
  expect(reopen.status()).toBe(400);
  const reopenBody = (await reopen.json()) as { error: { code: string } };
  expect(reopenBody.error.code).toBe("SetupClosed");

  // Wizard status reflects permanent close.
  const closed = await request.get("/console/setup/status");
  const closedBody = (await closed.json()) as {
    data: { setupClosed: boolean; claimRequired: boolean };
  };
  expect(closedBody.data.setupClosed).toBe(true);
  expect(closedBody.data.claimRequired).toBe(false);
});
