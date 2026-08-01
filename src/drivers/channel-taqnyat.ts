/**
 * `taqnyat` channel driver — SMS via sently's Taqnyat transport.
 */

import { TaqnyatSmsTransport } from "sently/transports/taqnyat-sms";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open a Taqnyat SMS driver.
 *
 * @param options - `bearerToken`/`token`/`apiKey` + `sender`/`from`
 */
export function openTaqnyatChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const bearerToken = options.bearerToken ?? options.token ?? options.apiKey;
  const sender = options.sender ?? options.from;
  if (!bearerToken) {
    throw new Error("taqnyat channel: bearerToken (or token/apiKey) is required");
  }
  if (!sender) {
    throw new Error("taqnyat channel: sender (or from) is required");
  }

  const transport = new TaqnyatSmsTransport({ bearerToken, sender });

  const channel: ChannelTransport = {
    provider: "taqnyat",
    mediums: ["sms"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      try {
        const result = await transport.send({
          to: message.to,
          body: message.text ?? String(message.data?.code ?? ""),
          ...(message.from ? { from: message.from } : {}),
        });
        return mapSentlySendResult("taqnyat", result);
      } catch (err) {
        return mapSentlySendError("taqnyat", err);
      }
    },
    verify: () => transport.verify(),
  };

  return { id: "taqnyat", channel, smsTransport: transport };
}

/** Taqnyat driver factory. */
export const taqnyatChannelDriver = {
  id: "taqnyat" as const,
  open: openTaqnyatChannel,
};
