/**
 * `fcm` channel driver — Firebase Cloud Messaging HTTP v1 (protocol-shaped).
 */

import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open an FCM push driver.
 *
 * @param options - `token` (OAuth access token) + `from` (project id)
 */
export function openFcmChannel(
  options: ChannelOpenOptions = {},
): ChannelDriver {
  const accessToken = options.token ?? options.apiKey;
  const projectId = options.from;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const base = options.url ?? "https://fcm.googleapis.com";

  const channel: ChannelTransport = {
    provider: "fcm",
    mediums: ["push"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      if (!accessToken || !projectId) {
        throw new Error("fcm: token and from (project id) are required");
      }
      const res = await fetchFn(
        `${base}/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: message.to,
              notification: {
                title: message.subject ?? message.template ?? "notification",
                body: message.text ?? "",
              },
              data: Object.fromEntries(
                Object.entries(message.data ?? {}).map(([k, v]) => [
                  k,
                  String(v),
                ]),
              ),
            },
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        name?: string;
        error?: { message?: string };
      };
      const id = body.name ?? crypto.randomUUID();
      if (!res.ok) {
        return {
          ok: false,
          messageId: id,
          driverId: "fcm",
          attempts: [
            {
              driverId: "fcm",
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
        driverId: "fcm",
        attempts: [
          { driverId: "fcm", ok: true, at: Date.now(), messageId: id },
        ],
      };
    },
  };

  return { id: "fcm", channel };
}

/** FCM driver factory. */
export const fcmChannelDriver = {
  id: "fcm" as const,
  open: openFcmChannel,
};
