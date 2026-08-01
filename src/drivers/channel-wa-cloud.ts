/**
 * `wa-cloud` channel driver — WhatsApp Cloud API via sently.
 */

import { WhatsAppCloudTransport } from "sently/transports/whatsapp-cloud";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
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
 * @param options - `token`/`apiKey` (access token) + `from` (phone number id)
 */
export function openWaCloudChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const accessToken = options.token ?? options.apiKey;
  const phoneNumberId = options.from;
  if (!accessToken || !phoneNumberId) {
    throw new Error("wa-cloud: token and from (phone number id) are required");
  }

  const transport = new WhatsAppCloudTransport({ accessToken, phoneNumberId });

  const channel: ChannelTransport = {
    provider: "wa-cloud",
    mediums: ["whatsapp"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      try {
        const templateName =
          message.template ??
          (typeof message.data?.template === "string" ? message.data.template : undefined);
        const language =
          message.locale ??
          (typeof message.data?.language === "string" ? message.data.language : "en_US");

        const result = templateName
          ? await transport.send({
              to: message.to,
              template: { name: templateName, language },
            })
          : await transport.send({
              to: message.to,
              text: message.text ?? "",
            });

        return mapSentlySendResult("wa-cloud", result);
      } catch (err) {
        return mapSentlySendError("wa-cloud", err);
      }
    },
    verify: () => transport.verify(),
  };

  return { id: "wa-cloud", channel, whatsappTransport: transport };
}

/** WhatsApp Cloud driver factory. */
export const waCloudChannelDriver = {
  id: "wa-cloud" as const,
  open: openWaCloudChannel,
};
