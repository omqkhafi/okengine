/**
 * `sndr` channel driver — wraps sently's SNDR transport unchanged.
 */

import { SndrTransport } from "sently/transports/sndr";
import type { ChannelDriver, ChannelOpenOptions } from "./channel-types.ts";

/**
 * Open an SNDR channel driver.
 *
 * @param options - API key
 */
export function openSndrChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  if (!options.apiKey) {
    throw new Error("sndr channel: apiKey is required");
  }
  const transport = new SndrTransport({
    apiKey: options.apiKey,
    ...(options.url ? { baseUrl: options.url } : {}),
  });
  return { id: "sndr", transport };
}

/** SNDR driver factory. */
export const sndrChannelDriver = {
  id: "sndr" as const,
  open: openSndrChannel,
};
