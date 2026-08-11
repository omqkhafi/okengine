/**
 * ui-next setup + login + shell — real kernel + real SPA.
 * Claim/login navigate to the authenticated shell; unauth shell visits redirect.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPERATOR_EMAIL = "smoke@example.com";
const OPERATOR_NAME = "Smoke Ops";
const OPERATOR_PASSWORD = "Password1234!";

/**
 * Assert the authenticated shell is visible for the signed-in operator.
 *
 * @param page - Playwright page
 * @param sectionTitle - Empty-state title for the active section
 */
async function expectShell(
  page: import("@playwright/test").Page,
  sectionTitle: string,
): Promise<void> {
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 15_000 });
  await expect(sidebar.getByRole("link", { name: "Flows" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Units" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Store" })).toBeVisible();
  await expect(page.getByText(sectionTitle)).toBeVisible();

  // Sidebar starts collapsed (icon mode) — expand via the brand hover trigger
  // (inset SidebarTrigger is md:hidden on desktop viewports).
  const brand = sidebar.locator('[data-sidebar="header"]');
  await brand.hover();
  await sidebar.locator('[data-slot="sidebar-trigger"]').click();
  await expect(sidebar.getByText(OPERATOR_NAME)).toBeVisible();
  await expect(sidebar.getByText(OPERATOR_EMAIL)).toBeVisible();
  await expect(page.locator('[data-slot="operator-avatar"]')).toBeVisible();
}

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

  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });
  await expectShell(page, "Traces");

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

  await page.evaluate(() => sessionStorage.removeItem("oke_console_at"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("Setup is closed. Sign in with an existing operator account."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create admin account" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("ui-next login rejects wrong password then succeeds into the shell", async ({
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

  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });
  await expectShell(page, "Traces");

  const token = await page.evaluate(() => sessionStorage.getItem("oke_console_at"));
  expect(token).toBeTruthy();

  await expect(page.locator('[data-slot="flow-graph"]')).toBeVisible();
  await expect(page.locator('[data-slot="traces-pane"]')).toBeVisible();
  await expect(page.getByText("Traces")).toBeVisible();
});

test("ui-next unauthenticated shell visit redirects to the pre-auth gate", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.removeItem("oke_console_at");
    sessionStorage.removeItem("oke_console_operator");
  });
  await page.goto("/flows");
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
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

test("ui-next Flows graph renders Manifest nodes, shows a seeded run, and highlights on click", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate(() => sessionStorage.removeItem("oke_console_at"));
  await page.locator("#email").fill(OPERATOR_EMAIL);
  await page.locator("#password").fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });

  const graph = page.locator('[data-slot="flow-graph"]');
  await expect(graph).toBeVisible({ timeout: 15_000 });

  // Real Manifest nodes (skyport seed) — unit headers + flow actions.
  await expect(graph.getByText("bookings", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="flow-node"][data-flow-id="bookings.create"]')).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await expect(
    page.locator('[data-slot="flow-node"][data-flow-id="fulfillment.onOrder"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="flow-node"][data-flow-id="payments.chargeBooking"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="flow-node"][data-flow-id="ops.nightlyReconcile"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="flow-node"][data-flow-id="support.triage"]'),
  ).toBeVisible();
  await expect(page.locator('[data-slot="flow-node"][data-flow-id="holds.expire"]')).toBeVisible();
  // AI / store / signal targets from declared effects.
  await expect(page.locator('[data-slot="ai-node"]')).toBeVisible();
  await expect(page.locator('[data-slot="store-node"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="signal-node"]').first()).toBeVisible();

  const traces = page.locator('[data-slot="traces-pane"]');
  await expect(traces).toBeVisible();
  // Featured (8) + operational (72) = 80.
  await expect(traces.locator('[data-slot="trace-row"]')).toHaveCount(80, { timeout: 15_000 });
  await expect(traces.locator('[data-run-id="pw-run-fulfillment-on-order"]')).toBeVisible();
  await expect(traces.locator('[data-run-id="pw-run-bookings-create-fail"]')).toBeVisible();
  await expect(traces.locator('[data-run-id="pw-run-bookings-create-fail"]')).toHaveAttribute(
    "data-failed",
    "true",
  );
  await expect(traces.locator('[data-run-id="pw-run-support-triage"]')).toBeVisible();
  // Operational bulk is present (scrollable list — count already covers volume).
  await expect(traces.locator('[data-run-id^="pw-ops-"]')).toHaveCount(72);

  const row = traces.locator('[data-run-id="pw-run-bookings-create"]');
  await expect(row).toBeVisible({ timeout: 15_000 });

  const createNode = page.locator('[data-slot="flow-node"][data-flow-id="bookings.create"]');
  const fulfillNode = page.locator('[data-slot="flow-node"][data-flow-id="fulfillment.onOrder"]');
  const paymentsNode = page.locator(
    '[data-slot="flow-node"][data-flow-id="payments.chargeBooking"]',
  );
  await expect(createNode).toHaveAttribute("data-highlighted", "false");

  await row.click();
  await expect(page).toHaveURL(/run=pw-run-bookings-create/);
  await expect(createNode).toHaveAttribute("data-highlighted", "true", { timeout: 5_000 });
  await expect(fulfillNode).toHaveAttribute("data-highlighted", "true");
  await expect(paymentsNode).toHaveAttribute("data-highlighted", "true");
  await expect(row).toHaveAttribute("data-selected", "true");
  await expect(page.locator('[data-slot="trace-detail-sheet"]')).toBeVisible();
  await expect(page.locator('[data-slot="trace-waterfall"]')).toBeVisible();
  await expect(page.locator('[data-slot="trace-request"]')).toBeVisible();
  await expect(page.locator('[data-slot="trace-request-method"]')).toHaveText("POST");
  await expect(page.locator('[data-slot="trace-request"]')).toContainText("/bookings");
  await expect(page.locator('[data-slot="trace-response"]')).toBeVisible();
  await expect(page.locator('[data-slot="trace-response"]')).toContainText("bk_8f2a");
});

/**
 * Sign in and open Flows so the seeded Traces pane is ready.
 *
 * @param page - Playwright page
 */
async function signInAndOpenFlows(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate(() => sessionStorage.removeItem("oke_console_at"));
  await page.locator("#email").fill(OPERATOR_EMAIL);
  await page.locator("#password").fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });
  await expect(page.locator('[data-slot="traces-pane"]')).toBeVisible({ timeout: 15_000 });
}

test("ui-next: failed trace sheet shows error in Response", async ({ page }) => {
  test.setTimeout(90_000);
  await signInAndOpenFlows(page);

  const traces = page.locator('[data-slot="traces-pane"]');
  const failRow = traces.locator('[data-run-id="pw-run-bookings-create-fail"]');
  await expect(failRow).toBeVisible({ timeout: 15_000 });
  await failRow.locator("button").first().click();

  await expect(page.locator('[data-slot="trace-detail-sheet"]')).toBeVisible();
  await expect(page.locator('[data-slot="trace-response-error"]')).toBeVisible();
  await expect(page.locator('[data-slot="trace-response-error"]')).toContainText("FlightFull");
  await expect(page.locator('[data-slot="trace-response-error"]')).toContainText(
    "No seats left on SK-902",
  );
});

test("ui-next Traces: waterfall tooltip, Advanced filter, and Copy run ID", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInAndOpenFlows(page);

  const traces = page.locator('[data-slot="traces-pane"]');
  await expect(traces.locator('[data-slot="trace-row"]')).toHaveCount(80, { timeout: 15_000 });

  // 1) Advanced opens the real dimension-query panel and filters the list.
  await traces.locator('[data-slot="traces-advanced-toggle"]').click();
  const advanced = traces.locator('[data-slot="traces-advanced-filters"]');
  await expect(advanced).toBeVisible();
  await advanced.getByRole("button", { name: "Signal", exact: true }).click();
  await expect(traces.locator('[data-run-id="pw-run-fulfillment-on-order"]')).toBeVisible();
  await expect(traces.locator('[data-run-id="pw-run-bookings-create"]')).toHaveCount(0);
  const signalCount = await traces.locator('[data-slot="trace-row"]').count();
  expect(signalCount).toBeGreaterThan(0);
  expect(signalCount).toBeLessThan(80);
  await advanced.getByRole("button", { name: "Clear" }).click();
  await expect(traces.locator('[data-slot="trace-row"]')).toHaveCount(80);

  // 2) Copy run ID writes the real run id to the clipboard.
  const row = traces.locator('[data-run-id="pw-run-bookings-create"]');
  await row.hover();
  await row.locator('[data-slot="trace-copy-id"]').click();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("pw-run-bookings-create");

  // 3) Waterfall bar hover shows kind · resource · duration · +offset.
  await row.locator("button").first().click();
  await expect(page.locator('[data-slot="trace-detail-sheet"]')).toBeVisible();
  const track = page.locator('[data-slot="trace-waterfall-track"]').first();
  await expect(track).toBeVisible();
  await track.hover();
  const tip = page.locator('[data-slot="tooltip-content"]').filter({
    hasText: "DB query · sql:bookings · 9ms · +3ms",
  });
  await expect(tip).toBeVisible({ timeout: 5_000 });
});

test("ui-next Units: Call API invokes for real (non-stub response)", async ({ page, request }) => {
  test.setTimeout(90_000);

  const status = await request.get("/console/setup/status");
  const statusBody = (await status.json()) as {
    data: { setupClosed: boolean; claimRequired: boolean };
  };

  await page.goto("/");
  await page.evaluate(() => sessionStorage.removeItem("oke_console_at"));

  if (statusBody.data.claimRequired) {
    const claimPath = join(dirname(fileURLToPath(import.meta.url)), ".claim-code-ui-next");
    const claimCode = readFileSync(claimPath, "utf8").trim();
    await expect(page.getByRole("heading", { name: "First admin" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator("#claimCode").fill(claimCode);
    await page.locator("#name").fill(OPERATOR_NAME);
    await page.locator("#email").fill(OPERATOR_EMAIL);
    await page.locator("#password").fill(OPERATOR_PASSWORD);
    await page.getByRole("button", { name: "Create admin account" }).click();
  } else {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator("#email").fill(OPERATOR_EMAIL);
    await page.locator("#password").fill(OPERATOR_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  await expect(page).toHaveURL(/\/flows$/, { timeout: 15_000 });

  await page.locator('[data-slot="sidebar"]').getByRole("link", { name: "Units" }).click();
  await expect(page).toHaveURL(/\/units/);
  await expect(page.locator('[data-slot="units-page"]')).toBeVisible({ timeout: 15_000 });

  const createItem = page.locator('[data-slot="unit-flow-item"][data-flow-id="bookings.create"]');
  await expect(createItem).toBeVisible({ timeout: 15_000 });
  await createItem.click();

  await expect(page.locator('[data-slot="flow-contract-panel"]')).toBeVisible();
  await expect(page.locator('[data-slot="call-api-panel"]')).toBeVisible();

  await expect(page.locator('[data-slot="call-api-identity"]')).toBeVisible();
  await expect(page.locator('[data-slot="call-api-submit"]')).toBeEnabled({ timeout: 10_000 });

  const flightInput = page.locator("#body-flightId");
  await expect(flightInput).toBeVisible();
  await flightInput.fill("SK1");
  const seatsInput = page.locator("#body-seats");
  await expect(seatsInput).toBeVisible();
  await seatsInput.fill("2");

  const invokeWait = page.waitForResponse(
    (res) => res.url().includes("/console/flows/invoke") && res.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.locator('[data-slot="call-api-submit"]').click();
  const invokeRes = await invokeWait;
  expect(invokeRes.ok()).toBeTruthy();
  const invokeJson = (await invokeRes.json()) as {
    data?: { response?: { id?: string } };
    error?: { code?: string };
  };
  expect(invokeJson.error ?? null).toBeNull();
  expect(invokeJson.data?.response?.id).toBe("real_SK1_2");

  const response = page.locator('[data-slot="call-api-response"]');
  await expect(response).toBeVisible({ timeout: 10_000 });
  await expect(response).toContainText("real_SK1_2");
  await expect(response).not.toContainText('"echo"');
  await expect(response).not.toContainText("inv_");
});
