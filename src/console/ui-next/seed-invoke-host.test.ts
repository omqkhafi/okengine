/**
 * Seed invoke host — Call API output is store data, not a stub echo.
 */

import { describe, expect, test } from "bun:test";
import { userPrincipal } from "../../auth/planes.ts";
import { bootUiNextSeedInvoke } from "./seed-invoke-host.ts";

describe("bootUiNextSeedInvoke", () => {
  test("tasks.list returns store rows; placeholder delete is NotFound", async () => {
    const host = await bootUiNextSeedInvoke();
    try {
      const principal = userPrincipal({
        userId: "user_demo",
        scopes: ["task:write", "files:write"],
        verified: true,
      });
      const listed = await host.invokeUserFlow({
        flowId: "tasks.list",
        body: {},
        principal,
        operatorId: "op_test",
      });
      expect(listed.failure).toBeUndefined();
      expect(listed.status).toBe(200);
      const payload = listed.output as {
        items: Array<{ id: string }>;
        total: number;
      };
      expect(payload.items.length).toBeGreaterThan(0);
      expect(payload.total).toBeGreaterThan(payload.items.length);
      expect(payload).not.toMatchObject({ ok: true, flow: "tasks.list" });

      const denied = await host.invokeUserFlow({
        flowId: "attachments.delete",
        body: {},
        pathParams: { id: ":id" },
        principal,
        operatorId: "op_test",
      });
      expect(denied.failure?.code).toBe("NotFound");
      expect(denied.status).toBe(404);
    } finally {
      await host.stop();
    }
  });
});
