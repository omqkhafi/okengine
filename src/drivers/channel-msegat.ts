/**
 * `msegat` channel driver — SMS via sently's Msegat transport.
 */

import { MsegatTransport } from "sently/transports/msegat";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open a Msegat SMS driver.
 *
 * @param options - `userName`/`user` + `apiKey` + `sender`/`from`
 */
export function openMsegatChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const userName = options.userName ?? options.user;
  const apiKey = options.apiKey;
  const sender = options.sender ?? options.from;
  if (!userName) {
    throw new Error("msegat channel: userName (or user) is required");
  }
  if (!apiKey) {
    throw new Error("msegat channel: apiKey is required");
  }
  if (!sender) {
    throw new Error("msegat channel: sender (or from) is required");
  }

  const transport = new MsegatTransport({ userName, apiKey, sender });

  const channel: ChannelTransport = {
    provider: "msegat",
    mediums: ["sms"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      try {
        const result = await transport.send({
          to: message.to,
          body: message.text ?? String(message.data?.code ?? ""),
          ...(message.from ? { from: message.from } : {}),
        });
        return mapSentlySendResult("msegat", result);
      } catch (err) {
        return mapSentlySendError("msegat", err);
      }
    },
    verify: () => transport.verify(),
  };

  return { id: "msegat", channel, smsTransport: transport };
}

/** Msegat driver factory. */
export const msegatChannelDriver = {
  id: "msegat" as const,
  open: openMsegatChannel,
};
