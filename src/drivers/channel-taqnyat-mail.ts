/**
 * `taqnyat-mail` channel driver — Email via sently's Taqnyat Mail transport.
 *
 * Additive email option (alongside smtp / resend / sndr). Taqnyat's
 * `mailSend.php` requires a campaign name — set via options or
 * `TAQNYAT_CAMPAIGN`.
 */

import { TaqnyatMailTransport } from "sently/transports/taqnyat-mail";
import type { ChannelDriver, ChannelOpenOptions } from "./channel-types.ts";

/**
 * Open a Taqnyat Email driver.
 *
 * @param options - `bearerToken`/`token`/`apiKey` + `campaignName`
 */
export function openTaqnyatMailChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const bearerToken = options.bearerToken ?? options.token ?? options.apiKey;
  if (!bearerToken) {
    throw new Error("taqnyat-mail channel: bearerToken (or token/apiKey) is required");
  }
  const campaignName = options.campaignName;
  if (!campaignName) {
    throw new Error("taqnyat-mail channel: campaignName is required");
  }
  const transport = new TaqnyatMailTransport({ bearerToken, campaignName });
  return { id: "taqnyat-mail", transport };
}

/** Taqnyat Email driver factory. */
export const taqnyatMailChannelDriver = {
  id: "taqnyat-mail" as const,
  open: openTaqnyatMailChannel,
};
