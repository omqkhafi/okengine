/**
 * `wa-cloud` channel driver — WhatsApp Cloud API (Meta).
 */

import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open a WhatsApp Cloud API driver.
 *
 * @param options - `token` (access token) + `from` (phone number id)
 */
export function openWaCloudChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const token = options.token ?? options.apiKey;
  const phoneNumberId = options.from;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const base = options.url ?? "https://graph.facebook.com/v19.0";

  const channel: ChannelTransport = {
    provider: "wa-cloud",
    mediums: ["whatsapp"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      if (!token || !phoneNumberId) {
        throw new Error("wa-cloud: token and from (phone number id) are required");
      }
      const res = await fetchFn(`${base}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: message.to,
          type: "text",
          text: { body: message.text ?? "" },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      const id = body.messages?.[0]?.id ?? crypto.randomUUID();
      if (!res.ok) {
        return {
          ok: false,
          messageId: id,
          driverId: "wa-cloud",
          attempts: [
            {
              driverId: "wa-cloud",
              ok: false,
              error: body.error?.message ?? `HTTP ${res.status}`,
              at: Date.now(),
            },
          ],
        };
      }
      return {
        ok: true,
        messageId: id,
        driverId: "wa-cloud",
        attempts: [{ driverId: "wa-cloud", ok: true, at: Date.now(), messageId: id }],
      };
    },
  };

  return { id: "wa-cloud", channel };
}

/** WhatsApp Cloud driver factory. */
export const waCloudChannelDriver = {
  id: "wa-cloud" as const,
  open: openWaCloudChannel,
};
