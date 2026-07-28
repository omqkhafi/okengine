/**
 * `console` channel driver — dev inbox for every medium.
 */

import type { AddressInput, MailOptions, SendResult, Transport } from "sently";
import type {
  ChannelDriver,
  ChannelInbox,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";
import { createChannelInbox } from "./channel-types.ts";

/**
 * Flatten a sently {@link AddressInput} to a comma-separated string.
 *
 * @param input - Address input
 */
function formatAddressInput(input: AddressInput): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    return input.map((t) => (typeof t === "string" ? t : t.address)).join(",");
  }
  return input.address;
}

/**
 * Open a console channel driver bound to an inbox.
 *
 * @param options - Optional shared inbox
 */
export function openConsoleChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const inbox = options.inbox ?? createChannelInbox();

  const channel: ChannelTransport = {
    provider: "console",
    mediums: ["email", "sms", "whatsapp", "push", "any"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      const id = crypto.randomUUID();
      inbox.push({
        id,
        medium: message.medium,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        data: message.data,
        template: message.template,
        locale: message.locale,
        at: Date.now(),
      });
      return {
        ok: true,
        messageId: id,
        driverId: "console",
        attempts: [
          {
            driverId: "console",
            ok: true,
            at: Date.now(),
            messageId: id,
          },
        ],
      };
    },
  };

  const transport: Transport = {
    provider: "console",
    async send(mail: MailOptions): Promise<SendResult> {
      const to = formatAddressInput(mail.to);
      const from = formatAddressInput(mail.from);
      const id = crypto.randomUUID();
      inbox.push({
        id,
        medium: "email",
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        data: mail.data,
        template: mail.template,
        at: Date.now(),
      });
      const recipients = to
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        messageId: id,
        accepted: recipients,
        rejected: [],
        response: "console: accepted",
        envelope: {
          from,
          to: recipients,
        },
        provider: "console",
        providerIndex: 0,
      };
    },
  };

  return { id: "console", transport, channel };
}

/**
 * Console driver factory (stateless open via {@link openConsoleChannel}).
 */
export const consoleChannelDriver = {
  id: "console" as const,
  open: openConsoleChannel,
};

export type { ChannelInbox };
