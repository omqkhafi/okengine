/**
 * `unifonic` channel driver — SMS via Unifonic REST API.
 */

import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open a Unifonic SMS driver.
 *
 * @param options - `apiKey` + optional `from` (sender id)
 */
export function openUnifonicChannel(
  options: ChannelOpenOptions = {},
): ChannelDriver {
  const apiKey = options.apiKey;
  const from = options.from ?? "OKE";
  const fetchFn = options.fetch ?? globalThis.fetch;
  const base = options.url ?? "https://el.cloud.unifonic.com";

  const channel: ChannelTransport = {
    provider: "unifonic",
    mediums: ["sms"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      if (!apiKey) {
        throw new Error("unifonic: apiKey is required");
      }
      const body = new URLSearchParams({
        AppSid: apiKey,
        Recipient: message.to,
        Body: message.text ?? String(message.data?.code ?? ""),
        SenderID: message.from ?? from,
      });
      const res = await fetchFn(`${base}/rest/SMS/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await res.text();
      const id = crypto.randomUUID();
      if (!res.ok) {
        return {
          ok: false,
          messageId: id,
          driverId: "unifonic",
          attempts: [
            {
              driverId: "unifonic",
              ok: false,
              error: text || `HTTP ${res.status}`,
              at: Date.now(),
            },
          ],
        };
      }
      return {
        ok: true,
        messageId: id,
        driverId: "unifonic",
        attempts: [
          { driverId: "unifonic", ok: true, at: Date.now(), messageId: id },
        ],
      };
    },
  };

  return { id: "unifonic", channel };
}

/** Unifonic driver factory. */
export const unifonicChannelDriver = {
  id: "unifonic" as const,
  open: openUnifonicChannel,
};
