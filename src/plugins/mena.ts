/**
 * MENA channel plugin — Taqnyat, Unifonic, and Msegat behind one plugin.
 *
 * Drivers stay the protocol adapters. `fx.sendOtp`, `fx.verifyOtp`, and
 * `fx.deliverOtp` remain supported Channel methods.
 */

import { openMsegatChannel } from "../drivers/channel-msegat.ts";
import { openTaqnyatChannel } from "../drivers/channel-taqnyat.ts";
import { openTaqnyatMailChannel } from "../drivers/channel-taqnyat-mail.ts";
import { openTaqnyatWhatsAppChannel } from "../drivers/channel-taqnyat-whatsapp.ts";
import { openUnifonicChannel } from "../drivers/channel-unifonic.ts";
import type { ChannelDriver, ChannelOpenOptions } from "../drivers/channel-types.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";

export {
  openMsegatChannel,
  openTaqnyatChannel,
  openTaqnyatMailChannel,
  openTaqnyatWhatsAppChannel,
  openUnifonicChannel,
};

/** Which MENA providers to open. Omitted providers are skipped. */
export interface MenaChannelOptions {
  readonly sms?: ChannelOpenOptions;
  readonly unifonic?: ChannelOpenOptions;
  readonly msegat?: ChannelOpenOptions;
  readonly mail?: ChannelOpenOptions;
  readonly whatsapp?: ChannelOpenOptions;
}

/**
 * Open the MENA drivers that have options.
 *
 * @param options - Per-provider credentials (`bearerToken` / `sender` / …)
 */
export function menaChannels(options: MenaChannelOptions = {}): ChannelDriver[] {
  const drivers: ChannelDriver[] = [];
  if (options.sms) drivers.push(openTaqnyatChannel(options.sms));
  if (options.unifonic) drivers.push(openUnifonicChannel(options.unifonic));
  if (options.msegat) drivers.push(openMsegatChannel(options.msegat));
  if (options.mail) drivers.push(openTaqnyatMailChannel(options.mail));
  if (options.whatsapp) drivers.push(openTaqnyatWhatsAppChannel(options.whatsapp));
  return drivers;
}

/**
 * Headline plugin. Attach with `.plug(mena())`. Drivers come from
 * {@link menaChannels}; this registration is the product name.
 *
 * @param options - Unused today; reserved for plugin config
 */
export function mena(options: MenaChannelOptions = {}): PluginDef {
  return plugin("mena", { version: "1", config: options });
}
