/**
 * `smtp` channel driver — wraps sently's SMTP transport with the Bun socket adapter.
 */

import { BunAdapter } from "sently/adapters/bun";
import { SMTPTransport } from "sently/transports/smtp";
import type { ChannelDriver, ChannelOpenOptions } from "./channel-types.ts";

/**
 * Open an SMTP channel driver.
 *
 * @param options - Host / port / auth
 */
export function openSmtpChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  if (!options.host) {
    throw new Error("smtp channel: host is required");
  }
  const port = options.port ?? 587;
  // Implicit TLS only on the classic SMTPS port; Mailpit / local relays are plain.
  const secure = port === 465;
  const transport = new SMTPTransport({
    host: options.host,
    port,
    secure,
    adapter: new BunAdapter({ secure }),
    ...(options.user && options.pass ? { auth: { user: options.user, pass: options.pass } } : {}),
  });
  return { id: "smtp", transport };
}

/** SMTP driver factory. */
export const smtpChannelDriver = {
  id: "smtp" as const,
  open: openSmtpChannel,
};
