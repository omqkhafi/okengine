/**
 * `webpush` channel driver — RFC 8030 + VAPID via sently.
 *
 * Call path: ChannelTransport.send → createPushSender → WebPushTransport.
 */

import { createPushSender } from "sently/push";
import { WebPushTransport } from "sently/transports/webpush";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open a Web Push driver (RFC 8030 + VAPID).
 *
 * @param options - VAPID keys + subject
 */
export function openWebPushChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const vapidPublicKey = options.vapidPublicKey;
  const vapidPrivateKey = options.vapidPrivateKey;
  const subject = options.vapidSubject ?? "mailto:ops@oke.local";
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error("webpush: vapidPublicKey and vapidPrivateKey are required");
  }

  const transport = new WebPushTransport({
    vapidPublicKey,
    vapidPrivateKey,
    subject,
  });
  const sender = createPushSender({ transport });

  const channel: ChannelTransport = {
    provider: "webpush",
    mediums: ["push"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      const sub = message.pushSubscription;
      const endpoint = sub?.endpoint ?? message.to;
      if (!endpoint.startsWith("http") || !sub?.keys?.p256dh || !sub.keys.auth) {
        throw new Error("webpush: pushSubscription with endpoint + keys is required");
      }

      try {
        const title =
          message.subject ??
          (typeof message.data?.title === "string" ? message.data.title : "Notification");
        const body = message.text ?? JSON.stringify(message.data ?? {});
        const result = await sender.send({
          subscription: {
            endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          },
          title,
          body,
          ...(message.data ? { data: { ...message.data } } : {}),
        });
        return mapSentlySendResult("webpush", result);
      } catch (err) {
        return mapSentlySendError("webpush", err);
      }
    },
    verify: () => sender.verify(),
    close: () => sender.close(),
  };

  return { id: "webpush", channel, pushTransport: transport };
}

/** Web Push driver factory. */
export const webpushChannelDriver = {
  id: "webpush" as const,
  open: openWebPushChannel,
};
