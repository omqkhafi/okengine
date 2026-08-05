/**
 * WhatsApp Business characterization (Known gap freeze):
 * - drivers pick template vs free-text by presence of message.template only
 * - Channel runtime has no 24h session-window API
 *
 * Meta requires free-form session messages inside a customer-initiated 24h
 * window and pre-approved templates outside it. OKE does not enforce that
 * window today — this file freezes the current payload-shape behavior so the
 * gap cannot silently look fixed without a real design.
 */

import { describe, expect, test } from "bun:test";
import type {
  ChannelDriver,
  ChannelMessage,
  ChannelSendResult,
} from "../../drivers/channel-types.ts";
import { channel, createChannelRuntime } from "../channel.ts";

type Captured =
  | { kind: "template"; name: string; language: string; to: string }
  | { kind: "text"; text: string; to: string };

function fakeWhatsAppDriver(captures: Captured[]): ChannelDriver {
  const channelTransport = {
    provider: "wa-cloud",
    mediums: ["whatsapp" as const],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      const templateName =
        message.template ??
        (typeof message.data?.template === "string" ? message.data.template : undefined);
      const language =
        message.locale ??
        (typeof message.data?.language === "string" ? message.data.language : "en_US");

      if (templateName) {
        captures.push({
          kind: "template",
          name: templateName,
          language,
          to: message.to,
        });
      } else {
        captures.push({
          kind: "text",
          text: message.text ?? "",
          to: message.to,
        });
      }

      return {
        ok: true,
        messageId: "wa-1",
        driverId: "wa-cloud",
        attempts: [{ driverId: "wa-cloud", ok: true, at: Date.now(), messageId: "wa-1" }],
      };
    },
  };

  return {
    id: "wa-cloud",
    channel: channelTransport,
    whatsappTransport: {
      provider: "wa-cloud",
      async send() {
        return { messageId: "x", to: "", status: "sent", response: "" };
      },
    },
  };
}

describe("WhatsApp session vs template (characterization)", () => {
  test("template name on the send path selects template payload shape", async () => {
    const captures: Captured[] = [];
    const runtime = createChannelRuntime({
      templates: [channel.template("order-update", { medium: "whatsapp" })],
      drivers: [fakeWhatsAppDriver(captures)],
      catalog: {
        "order-update": { en: { text: "Your order shipped" } },
      },
    });

    await runtime.send("order-update", {
      to: "+966500000000",
      locale: "en_US",
    });

    expect(captures).toEqual([
      {
        kind: "template",
        name: "order-update",
        language: "en_US",
        to: "+966500000000",
      },
    ]);
  });

  test("missing template name sends free-text (no session-window gate)", async () => {
    const captures: Captured[] = [];
    // Medium-agnostic path that still hits channel transport without a template
    // name on ChannelMessage — simulate driver-level choice when template unset.
    const driver = fakeWhatsAppDriver(captures);
    const result = await driver.channel!.send({
      medium: "whatsapp",
      to: "+966500000000",
      text: "Hello from session",
      // no template field — free-form
    });

    expect(result.ok).toBe(true);
    expect(captures).toEqual([{ kind: "text", text: "Hello from session", to: "+966500000000" }]);
  });

  test("ChannelRuntime has no session-window surface", () => {
    const runtime = createChannelRuntime({});
    const keys = Object.keys(runtime);
    expect(keys).not.toContain("sessionWindow");
    expect(keys).not.toContain("whatsappSession");
    expect(keys).not.toContain("withinSessionWindow");
    expect(typeof (runtime as { withinSessionWindow?: unknown }).withinSessionWindow).toBe(
      "undefined",
    );
  });
});
