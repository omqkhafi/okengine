/**
 * Sently-backed channel drivers — construction and message mapping.
 */

import { describe, expect, test } from "bun:test";
import { openFcmChannel } from "./channel-fcm.ts";
import { openMsegatChannel } from "./channel-msegat.ts";
import { openSndrChannel } from "./channel-sndr.ts";
import { openTaqnyatChannel } from "./channel-taqnyat.ts";
import { openUnifonicChannel } from "./channel-unifonic.ts";
import { openWaCloudChannel } from "./channel-wa-cloud.ts";
import { openWebPushChannel } from "./channel-webpush.ts";

describe("sently channel drivers", () => {
  test("sndr requires apiKey", () => {
    expect(() => openSndrChannel({})).toThrow("apiKey");
    const d = openSndrChannel({ apiKey: "sndr_test_x" });
    expect(d.id).toBe("sndr");
    expect(d.transport?.provider).toBe("sndr");
  });

  test("taqnyat requires bearer + sender", () => {
    expect(() => openTaqnyatChannel({ bearerToken: "t" })).toThrow("sender");
    const d = openTaqnyatChannel({ bearerToken: "t", sender: "Brand" });
    expect(d.id).toBe("taqnyat");
    expect(d.channel?.mediums).toContain("sms");
  });

  test("msegat requires userName + apiKey + sender", () => {
    expect(() => openMsegatChannel({ userName: "u", apiKey: "k" })).toThrow("sender");
    const d = openMsegatChannel({ userName: "u", apiKey: "k", sender: "Brand" });
    expect(d.id).toBe("msegat");
    expect(d.smsTransport?.provider).toBe("msegat");
  });

  test("unifonic requires appSid and exposes smsTransport", () => {
    expect(() => openUnifonicChannel({})).toThrow("appSid");
    const d = openUnifonicChannel({ appSid: "sid", sender: "Brand" });
    expect(d.id).toBe("unifonic");
    expect(d.smsTransport?.provider).toBe("unifonic");
  });

  test("fcm accepts access-token mode", () => {
    const d = openFcmChannel({ from: "my-project", token: "ya29.test" });
    expect(d.id).toBe("fcm");
    expect(d.pushTransport?.provider).toBe("fcm");
  });

  test("wa-cloud maps text and template sends", async () => {
    const calls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const d = openWaCloudChannel({ token: "tok", from: "123" });
      const text = await d.channel!.send({
        medium: "whatsapp",
        to: "15551234567",
        text: "hi",
      });
      expect(text.ok).toBe(true);
      expect(text.messageId).toBe("wamid.1");
      expect(calls[0]).toMatchObject({
        messaging_product: "whatsapp",
        to: "15551234567",
        type: "text",
      });

      const tpl = await d.channel!.send({
        medium: "whatsapp",
        to: "15551234567",
        template: "welcome",
        locale: "en_US",
      });
      expect(tpl.ok).toBe(true);
      expect(calls[1]).toMatchObject({
        type: "template",
        template: { name: "welcome", language: { code: "en_US" } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("webpush requires subscription keys", async () => {
    const d = openWebPushChannel({
      vapidPublicKey: "BPtestpublickeythatislongenoughforvapidxxxxxxxxxxxx",
      vapidPrivateKey: "dGVzdC1wcml2YXRlLWtleS0zMmJ5dGVzLW9rISEh",
      vapidSubject: "mailto:ops@example.com",
    });
    expect(d.id).toBe("webpush");
    expect(d.pushTransport?.provider).toBe("webpush");
    await expect(
      d.channel!.send({ medium: "push", to: "https://fcm.googleapis.com/fcm/send/x" }),
    ).rejects.toThrow("pushSubscription");
  });
});
