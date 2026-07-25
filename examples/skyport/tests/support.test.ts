import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";
import { triage } from "../src/ai";

test("AI triage is mockable and cost-bounded", async () => {
const t = await createTestApp(app);
t.ai.mock(triage, { urgency: "high", team: "ops", summary: "seat dispute" });

const u = await t.auth.loginAs({});
const { data } = await t.api.support.createTicket({ subject: "…", body: "…" }, { as: u });

expect(data!.urgency).toBe("high");
expect(t.ai.cost()).toBeLessThan(0.02);        // budgets are assertable
  await t.close();
});
