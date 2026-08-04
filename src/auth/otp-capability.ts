/**
 * Fail-loud capability checks for the otp() plugin (provider / app mode).
 */

import type { ChannelDriver, SmsOtpTransport } from "../drivers/channel-types.ts";
import type { OtpChannel } from "./verification.ts";

/** Config snapshot stored on the otp plugin for boot-time assertion. */
export interface OtpPluginConfig {
  readonly method: "otp";
  readonly mode: "provider" | "app";
  readonly channels?: readonly OtpChannel[];
}

/**
 * Whether an SMS transport exposes provider OTP via Verify (structural).
 *
 * @param t - Candidate transport
 */
export function isSmsOtpTransport(t: unknown): t is SmsOtpTransport {
  if (!t || typeof t !== "object") return false;
  const o = t as Partial<SmsOtpTransport>;
  return typeof o.sendOtp === "function" && typeof o.verifyOtp === "function";
}

/**
 * Find a bound SMS driver with real sendOtp/verifyOtp, or undefined.
 *
 * @param drivers - Bound channel drivers
 */
export function findOtpSmsDriver(
  drivers: readonly ChannelDriver[],
): { readonly driver: ChannelDriver; readonly otp: SmsOtpTransport } | undefined {
  for (const d of drivers) {
    if (isSmsOtpTransport(d.smsTransport)) {
      return { driver: d, otp: d.smsTransport };
    }
  }
  return undefined;
}

/**
 * Whether any bound driver can deliver on `medium`.
 *
 * @param drivers - Bound channel drivers
 * @param medium - OTP channel
 */
export function driverCoversMedium(drivers: readonly ChannelDriver[], medium: OtpChannel): boolean {
  for (const d of drivers) {
    if (medium === "email" && d.transport) return true;
    if (medium === "sms" && (d.smsTransport || d.channel?.mediums.includes("sms"))) return true;
    if (medium === "whatsapp" && (d.whatsappTransport || d.channel?.mediums.includes("whatsapp"))) {
      return true;
    }
    if (d.channel?.mediums.includes(medium) || d.channel?.mediums.includes("any")) return true;
  }
  return false;
}

/**
 * Assert provider mode: a Verify-capable SMS driver must be bound.
 *
 * @param drivers - Bound channel drivers
 */
export function assertOtpProviderModeCapability(drivers: readonly ChannelDriver[]): void {
  if (findOtpSmsDriver(drivers)) return;
  const sms = drivers.filter((d) => d.smsTransport);
  if (sms.length === 0) {
    throw new Error(
      'otp({ mode: "provider" }): no SMS driver with sendOtp/verifyOtp bound — set drivers.channel.sms to a Verify-capable driver (e.g. "taqnyat"), or switch to otp({ mode: "app", channels: [...] })',
    );
  }
  const id = sms[0]?.id ?? "unknown";
  throw new Error(
    `otp({ mode: "provider" }): SMS driver "${id}" does not support provider OTP — bind a Verify-capable driver (e.g. taqnyat), or switch to otp({ mode: "app", channels: [...] })`,
  );
}

/**
 * Assert app mode: every declared channel has a deliverable driver.
 *
 * @param drivers - Bound channel drivers
 * @param channels - Declared channel order
 */
export function assertOtpAppModeChannels(
  drivers: readonly ChannelDriver[],
  channels: readonly OtpChannel[],
): void {
  for (const ch of channels) {
    if (!driverCoversMedium(drivers, ch)) {
      throw new Error(
        `otp({ mode: "app" }): no channel driver covers "${ch}" — configure drivers.channel.${ch === "email" ? "email" : ch === "sms" ? "sms" : "whatsapp"}`,
      );
    }
  }
}

/**
 * Run the matching boot assertion for an otp plugin config snapshot.
 *
 * @param config - Plugin configSnapshot
 * @param drivers - Bound channel drivers
 */
export function assertOtpPluginCapability(
  config: unknown,
  drivers: readonly ChannelDriver[],
): void {
  if (!config || typeof config !== "object") return;
  const c = config as Partial<OtpPluginConfig>;
  if (c.method !== "otp") return;
  if (c.mode === "provider") {
    assertOtpProviderModeCapability(drivers);
    return;
  }
  if (c.mode === "app") {
    const channels = c.channels ?? [];
    assertOtpAppModeChannels(drivers, channels);
  }
}
