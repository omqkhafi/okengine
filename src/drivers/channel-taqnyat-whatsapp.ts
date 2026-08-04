/**
 * `taqnyat-whatsapp` channel driver — WhatsApp via sently's Taqnyat transport.
 *
 * Exposes {@link TaqnyatWhatsAppTransport} (including vendor-extra
 * `sendWithFailover`) on `whatsappTransport` for structural detection.
 */

import {
  TaqnyatWhatsAppTransport,
  type TaqnyatWhatsAppFailover,
} from "sently/transports/taqnyat-whatsapp";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/** Structural vendor-extra for provider-side SMS/email failover. */
export type WhatsAppFailoverTransport = {
  sendWithFailover(
    options:
      | { to: string; text: string }
      | { to: string; template: { name: string; language: string } },
    failover: TaqnyatWhatsAppFailover,
  ): Promise<{ readonly messageId: string; readonly status: string; readonly response: string }>;
};

/**
 * Whether a WhatsApp transport exposes `sendWithFailover` (structural).
 *
 * @param t - Candidate transport
 */
export function hasWhatsAppSendWithFailover(t: unknown): t is WhatsAppFailoverTransport {
  return (
    !!t &&
    typeof t === "object" &&
    typeof (t as { sendWithFailover?: unknown }).sendWithFailover === "function"
  );
}

/**
 * Open a Taqnyat WhatsApp driver.
 *
 * @param options - `bearerToken` / `token` / `apiKey`
 */
export function openTaqnyatWhatsAppChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const bearerToken = options.bearerToken ?? options.token ?? options.apiKey;
  if (!bearerToken) {
    throw new Error("taqnyat-whatsapp: bearerToken (or token/apiKey) is required");
  }

  const transport = new TaqnyatWhatsAppTransport({ bearerToken });

  const channel: ChannelTransport = {
    provider: "taqnyat-whatsapp",
    mediums: ["whatsapp"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      try {
        const templateName =
          message.template ??
          (typeof message.data?.template === "string" ? message.data.template : undefined);
        const language =
          message.locale ??
          (typeof message.data?.language === "string" ? message.data.language : "en");

        const result = templateName
          ? await transport.send({
              to: message.to,
              template: { name: templateName, language },
            })
          : await transport.send({
              to: message.to,
              text: message.text ?? String(message.data?.otp ?? ""),
            });

        return mapSentlySendResult("taqnyat-whatsapp", result);
      } catch (err) {
        return mapSentlySendError("taqnyat-whatsapp", err);
      }
    },
    verify: () => transport.verify(),
  };

  return { id: "taqnyat-whatsapp", channel, whatsappTransport: transport };
}

/** Taqnyat WhatsApp driver factory. */
export const taqnyatWhatsAppChannelDriver = {
  id: "taqnyat-whatsapp" as const,
  open: openTaqnyatWhatsAppChannel,
};
