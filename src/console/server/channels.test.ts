/**
 * Console Channels projection + send-test confirm (console §9.9).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "../../manifest/types.ts";
import {
  createManifestChannelRuntime,
  formatFallbackSummary,
  projectChannelsList,
} from "./channels.ts";
import { startConsoleApp } from "./serve.ts";
import { setManifest } from "./state.ts";

const manifest: Manifest = {
  oke: "1.0",
  app: "test",
  channels: {
    "otp-code": {
      medium: "any",
      locales: ["en", "ar"],
      from: "noreply@example.com",
    },
    "booking-confirmed": {
      medium: "email",
      locales: ["en"],
      from: "bookings@example.com",
    },
  },
};

describe("projectChannelsList", () => {
  test("dev face is inbox; outcomes carry verdicts; recipients masked", async () => {
    const { runtime, inbox } = createManifestChannelRuntime(manifest, {
      now: () => 1_000,
      catalog: {
        "otp-code": {
          en: { text: "code {{code}}" },
          ar: { text: "رمز {{code}}" },
        },
      },
    });
    await runtime.send("otp-code", {
      to: "user@example.com",
      data: { code: "1" },
    });
    runtime.ingestOutcome({
      messageId: runtime.receipts.all()[0]!.messageId!,
      state: "delivered-then-complained",
      to: "user@example.com",
    });
    runtime.ingestOutcome({
      messageId: "hb-1",
      state: "hard-bounce",
      to: "bounce@example.com",
      medium: "email",
      template: "booking-confirmed",
    });

    const list = projectChannelsList({
      manifest,
      runtime,
      inbox,
      production: false,
      now: () => 1_000,
    });

    expect(list.face).toBe("inbox");
    expect(list.inbox.length).toBeGreaterThan(0);
    expect(list.inbox[0]!.toMasked).toContain("***");
    expect(list.outcomes[0]!.state).toBe("delivered-then-complained");
    expect(list.outcomes[0]!.verdict).toBe("review");
    expect(list.suppression.some((s) => s.reason === "prior-bounce")).toBe(true);
  });

  test("fallback summary is a weekly bill line", () => {
    expect(
      formatFallbackSummary({
        fallbackRate: 0.23,
        weeklyDeltaUsd: 38,
        primaryMedium: "whatsapp",
      }),
    ).toBe("23% fell back · $38 / week above whatsapp-only");
  });
});

describe("console.channel.sendTest", () => {
  test("production requires typed SEND; confirmed send is real", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-channels-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-channels",
      silentClaim: true,
      production: true,
      manifest,
      channelCatalog: {
        "otp-code": { en: { text: "code {{code}}" } },
      },
    });
    try {
      setManifest(handle.state, manifest);
      // Re-bind channel after manifest set
      const { bindManifestChannelRuntime } = await import("./app.ts");
      bindManifestChannelRuntime(handle.state);

      const code = handle.state.claim.code;
      const claimRes = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: code,
            email: "ops@example.com",
            name: "Ops",
            password: "Password1234!",
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

      const denied = await handle.app.fetch(
        new Request("http://console.test/console/channels/send-test", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            template: "otp-code",
            to: "test@example.com",
            data: { code: "9999" },
          }),
        }),
      );
      expect(denied.status).toBe(400);
      const deniedBody = (await denied.json()) as {
        error: { code: string } | null;
      };
      expect(deniedBody.error?.code).toBe("ConfirmRequired");

      const before = handle.state.channelInbox?.entries.length ?? 0;
      const ok = await handle.app.fetch(
        new Request("http://console.test/console/channels/send-test", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            template: "otp-code",
            to: "test@example.com",
            data: { code: "9999" },
            confirmation: "SEND",
            reason: "verifying otp template in staging",
          }),
        }),
      );
      expect(ok.status).toBe(200);
      const okBody = (await ok.json()) as {
        data: { ok: boolean; messageId: string };
        error: null;
      };
      expect(okBody.error).toBeNull();
      expect(okBody.data.ok).toBe(true);
      expect(okBody.data.messageId.length).toBeGreaterThan(0);
      expect(handle.state.channelInbox?.entries.length ?? 0).toBeGreaterThan(before);
    } finally {
      await handle.app.stop();
    }
  });
});
