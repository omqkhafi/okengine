/**
 * ui-next setup claim — real kernel + real SPA: claim succeeds, already-claimed denied.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  await expect(page.getByRole("heading", { name: "Console" })).toBeVisible();

  await page.getByLabel("Claim code").fill(claimCode);
  await page.getByLabel("Name").fill("Smoke Ops");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Create first operator" }).click();

  await expect(page.getByText(/First operator created\. Signed in as Smoke Ops/)).toBeVisible({
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
      password: "password1234",
    },
  });
  expect(reopen.status()).toBe(400);
  const reopenBody = (await reopen.json()) as {
    error: { code: string; data?: { reason?: string } };
  };
  expect(reopenBody.error.code).toBe("SetupClosed");
  expect(reopenBody.error.data?.reason).toBe("first_operator_exists");

  await page.reload();
  await expect(
    page.getByText("Setup is closed. Sign in with an existing operator account."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Create first operator" })).toHaveCount(0);
});
