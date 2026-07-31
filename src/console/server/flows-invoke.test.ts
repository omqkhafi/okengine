/**
 * Console flows invoke-as + identities (console §9.2).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOWS_TEST_MANIFEST } from "../ui/flows/fixture.ts";
import { startConsoleApp } from "./serve.ts";
import { setManifest } from "./state.ts";

describe("console flows invoke", () => {
  test("lists identities and invokes as a user with local validation path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows",
      silentClaim: true,
      production: false,
      manifest: FLOWS_TEST_MANIFEST,
    });
    try {
      setManifest(handle.state, FLOWS_TEST_MANIFEST);
      const code = handle.state.claim.code;
      const claimRes = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: code,
            email: "ops@example.com",
            name: "Ops",
            password: "password1234",
          }),
        }),
      );
      expect(claimRes.status).toBe(200);
      const claimBody = (await claimRes.json()) as {
        data: { accessToken: string };
      };
      const auth = {
        authorization: `Bearer ${claimBody.data.accessToken}`,
        "content-type": "application/json",
      };

      const idsRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/identities", {
          headers: auth,
        }),
      );
      expect(idsRes.status).toBe(200);
      const idsBody = (await idsRes.json()) as {
        data: { identities: Array<{ id: string }> };
      };
      expect(idsBody.data.identities.length).toBeGreaterThan(0);
      const asUserId = idsBody.data.identities[0]!.id;

      const invokeRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "SK1", seats: 2 },
            asUserId,
          }),
        }),
      );
      expect(invokeRes.status).toBe(200);
      const invokeBody = (await invokeRes.json()) as {
        data: { ok: true; response: { id: string }; peakTier: string };
        error: null;
      };
      expect(invokeBody.error).toBeNull();
      expect(invokeBody.data.ok).toBe(true);
      expect(invokeBody.data.response.id).toMatch(/^inv_/);
      expect(invokeBody.data.peakTier).toBe("emits");
    } finally {
      await handle.app.stop();
    }
  });

  test("production irreversible invoke requires typed confirmation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows",
      silentClaim: true,
      production: true,
      manifest: FLOWS_TEST_MANIFEST,
    });
    try {
      const code = handle.state.claim.code;
      const claimRes = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: code,
            email: "ops@example.com",
            name: "Ops",
            password: "password1234",
          }),
        }),
      );
      const claimBody = (await claimRes.json()) as {
        data: { accessToken: string };
      };
      const auth = {
        authorization: `Bearer ${claimBody.data.accessToken}`,
        "content-type": "application/json",
      };

      const denied = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "fulfillment.onOrder",
            body: {},
            asUserId: "user_demo",
          }),
        }),
      );
      expect(denied.status).toBe(400);
      const deniedBody = (await denied.json()) as { error: { code: string } };
      expect(deniedBody.error.code).toBe("ConfirmRequired");

      const ok = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "fulfillment.onOrder",
            body: {},
            asUserId: "user_demo",
            confirmation: "INVOKE",
            reason: "incident dry-run",
          }),
        }),
      );
      expect(ok.status).toBe(200);
    } finally {
      await handle.app.stop();
    }
  });
});
