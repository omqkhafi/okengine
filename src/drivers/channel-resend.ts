/**
 * `resend` channel driver — wraps sently's Resend transport unchanged.
 */

import { ResendTransport } from "sently/transports/resend";
import type { ChannelDriver, ChannelOpenOptions } from "./channel-types.ts";

/**
 * Open a Resend channel driver.
 *
 * @param options - API key
 */
export function openResendChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  if (!options.apiKey) {
    throw new Error("resend channel: apiKey is required");
  }
  const transport = new ResendTransport({ apiKey: options.apiKey });
  return { id: "resend", transport };
}

/** Resend driver factory. */
export const resendChannelDriver = {
  id: "resend" as const,
  open: openResendChannel,
};
