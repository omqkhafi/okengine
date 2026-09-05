/**
 * `sndr` channel driver — wraps sently's SNDR transport unchanged.
 */

import { SndrTransport } from "sently/transports/sndr";
import type { ChannelDriver, ChannelOpenOptions } from "./channel-types.ts";
import { hostFromUrl } from "./external.ts";

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
  return {
    id: "sndr",
    transport,
    external: {
      host: (options.url ? hostFromUrl(options.url) : undefined) ?? "api.sndr.email",
      provider: "sndr",
      kind: "third-party",
    },
  };
}

/** SNDR driver factory. */
export const sndrChannelDriver = {
  id: "sndr" as const,
  open: openSndrChannel,
};
