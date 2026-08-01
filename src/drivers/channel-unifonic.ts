/**
 * `unifonic` channel driver — SMS via sently's Unifonic transport.
 */

import { UnifonicTransport } from "sently/transports/unifonic";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
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
 * @param options - `apiKey`/`appSid` (AppSid) + optional `sender`/`from` (SenderID)
 */
export function openUnifonicChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const appSid = options.appSid ?? options.apiKey;
  const senderId = options.sender ?? options.from;
  if (!appSid) {
    throw new Error("unifonic channel: appSid (or apiKey) is required");
  }

  const transport = new UnifonicTransport({
    appSid,
    ...(senderId ? { senderId } : {}),
    ...(options.url?.startsWith("https://") ? { statusCallback: options.url } : {}),
  });

  const channel: ChannelTransport = {
    provider: "unifonic",
    mediums: ["sms"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      try {
        const result = await transport.send({
          to: message.to,
          body: message.text ?? String(message.data?.code ?? ""),
          ...(message.from ? { from: message.from } : {}),
        });
        return mapSentlySendResult("unifonic", result);
      } catch (err) {
        return mapSentlySendError("unifonic", err);
      }
    },
    verify: () => transport.verify(),
  };

  return { id: "unifonic", channel, smsTransport: transport };
}

/** Unifonic driver factory. */
export const unifonicChannelDriver = {
  id: "unifonic" as const,
  open: openUnifonicChannel,
};
