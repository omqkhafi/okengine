/**
 * Lazy channel binder — loaded only when Channel is declared.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { CHANNEL_EMAIL_DEFAULTS, CHANNEL_SMS_DEFAULTS } from "../../config/driver-defaults.ts";
import { openConsoleChannel } from "../../drivers/channel-console.ts";
import { openMsegatChannel } from "../../drivers/channel-msegat.ts";
import { openResendChannel } from "../../drivers/channel-resend.ts";
import { openSmtpChannel } from "../../drivers/channel-smtp.ts";
import { openSndrChannel } from "../../drivers/channel-sndr.ts";
import { openTaqnyatChannel } from "../../drivers/channel-taqnyat.ts";
import { openTaqnyatMailChannel } from "../../drivers/channel-taqnyat-mail.ts";
import { openTaqnyatWhatsAppChannel } from "../../drivers/channel-taqnyat-whatsapp.ts";
import { openUnifonicChannel } from "../../drivers/channel-unifonic.ts";
import { openWaCloudChannel } from "../../drivers/channel-wa-cloud.ts";
import type { ChannelDriver, ChannelOpenOptions } from "../../drivers/channel-types.ts";
import { createChannelRuntime, type ChannelRuntime } from "../../elements/channel.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct a Channel runtime (console inbox default).
 *
 * When `options.channel.drivers` is omitted, opens the configured email driver
 * and, if `drivers.channel.sms` resolves, appends that SMS driver to the chain.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param docker - Prefer compose SMTP when active
 */
export function bindChannel(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
  docker = false,
): ChannelRuntime {
  return createChannelRuntime({
    ...(options.channel ?? {}),
    drivers: options.channel?.drivers ?? defaultDrivers(options, env, docker),
    now,
  });
}

function defaultDrivers(options: BootOptions, env: ConfigEnv, docker: boolean): ChannelDriver[] {
  const drivers: ChannelDriver[] = [emailDriverFor(options, env, docker)];
  const sms = smsDriverFor(options, env);
  if (sms) drivers.push(sms);
  const whatsapp = whatsappDriverFor(options, env);
  if (whatsapp) drivers.push(whatsapp);
  return drivers;
}

function emailDriverFor(options: BootOptions, env: ConfigEnv, docker: boolean): ChannelDriver {
  const id = resolveEmailDriverId(options, env, docker);
  if (id === "console") return openConsoleChannel();
  if (id === "smtp") return openSmtpChannel(smtpOptionsFromEnv(docker));
  if (id === "resend") return openResendChannel(resendOptionsFromEnv());
  if (id === "sndr") return openSndrChannel(sndrOptionsFromEnv());
  if (id === "taqnyat-mail") return openTaqnyatMailChannel(taqnyatMailOptionsFromEnv());
  throw new Error(`oke boot: unknown email channel driver "${id}"`);
}

function smsDriverFor(options: BootOptions, env: ConfigEnv): ChannelDriver | undefined {
  const id = resolveSmsDriverId(options, env);
  if (!id || id === "console") return undefined;
  if (id === "taqnyat") return openTaqnyatChannel(taqnyatOptionsFromEnv());
  if (id === "msegat") return openMsegatChannel(msegatOptionsFromEnv());
  if (id === "unifonic") return openUnifonicChannel(unifonicOptionsFromEnv());
  throw new Error(`oke boot: unknown sms channel driver "${id}"`);
}

/**
 * Resolve the configured email driver for one environment.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param docker - Docker mode
 */
export function resolveEmailDriverId(
  options: BootOptions,
  env: ConfigEnv,
  docker: boolean,
): string {
  void docker;
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.channel?.email, env, CHANNEL_EMAIL_DEFAULTS)!;
}

/**
 * Resolve the configured SMS driver for one environment.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveSmsDriverId(options: BootOptions, env: ConfigEnv): string | undefined {
  return resolveDriverId(options.config?.drivers?.channel?.sms, env, CHANNEL_SMS_DEFAULTS);
}

/**
 * Resolve the configured WhatsApp driver for one environment.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveWhatsappDriverId(options: BootOptions, env: ConfigEnv): string | undefined {
  return resolveDriverId(options.config?.drivers?.channel?.whatsapp, env);
}

function whatsappDriverFor(options: BootOptions, env: ConfigEnv): ChannelDriver | undefined {
  const id = resolveWhatsappDriverId(options, env);
  if (!id || id === "console") return undefined;
  if (id === "taqnyat-whatsapp") return openTaqnyatWhatsAppChannel(taqnyatWhatsAppOptionsFromEnv());
  if (id === "wa-cloud") return openWaCloudChannel(waCloudOptionsFromEnv());
  throw new Error(`oke boot: unknown whatsapp channel driver "${id}"`);
}

/**
 * Resolve Taqnyat WhatsApp options from env.
 */
export function taqnyatWhatsAppOptionsFromEnv(): ChannelOpenOptions {
  const bearerToken =
    process.env.TAQNYAT_WHATSAPP_TOKEN?.trim() ??
    process.env.TAQNYAT_BEARER_TOKEN?.trim() ??
    process.env.TAQNYAT_TOKEN?.trim();
  if (!bearerToken) {
    throw new Error(
      "oke boot: taqnyat-whatsapp channel needs TAQNYAT_WHATSAPP_TOKEN (or TAQNYAT_BEARER_TOKEN)",
    );
  }
  return { bearerToken };
}

/**
 * Resolve WhatsApp Cloud API options from env.
 */
export function waCloudOptionsFromEnv(): ChannelOpenOptions {
  const token = process.env.WHATSAPP_TOKEN?.trim() ?? process.env.WA_CLOUD_TOKEN?.trim();
  const from =
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? process.env.WA_CLOUD_PHONE_NUMBER_ID?.trim();
  if (!token || !from) {
    throw new Error("oke boot: wa-cloud channel needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
  }
  return { token, from };
}

/**
 * Resolve SMTP connection options from `SMTP_URL` plus optional auth overrides.
 *
 * @param docker - Whether to include the docker-specific missing URL hint
 */
export function smtpOptionsFromEnv(docker = false): ChannelOpenOptions {
  const raw = process.env.SMTP_URL ?? process.env.OKE_CHANNEL_EMAIL_URL;
  if (!raw) {
    throw new Error(
      docker
        ? "oke boot: smtp driver needs SMTP_URL (did `oke dev -d` write docker/.env.docker?)"
        : "oke boot: smtp driver needs SMTP_URL",
    );
  }
  const url = new URL(raw);
  if (url.protocol !== "smtp:") throw new Error(`oke boot: SMTP_URL must use smtp://`);
  const urlUser = url.username ? decodeURIComponent(url.username) : undefined;
  const urlPass = url.password ? decodeURIComponent(url.password) : undefined;
  const user = process.env.SMTP_USER ?? urlUser;
  const pass = process.env.SMTP_PASSWORD ?? urlPass;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 25,
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
  };
}

/**
 * Resolve Resend options from env.
 */
export function resendOptionsFromEnv(): ChannelOpenOptions {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("oke boot: resend channel needs RESEND_API_KEY");
  return { apiKey };
}

/**
 * Resolve SNDR options from env.
 */
export function sndrOptionsFromEnv(): ChannelOpenOptions {
  const apiKey = process.env.SNDR_API_KEY?.trim();
  if (!apiKey) throw new Error("oke boot: sndr channel needs SNDR_API_KEY");
  const url = process.env.SNDR_BASE_URL?.trim();
  return { apiKey, ...(url ? { url } : {}) };
}

/**
 * Resolve Taqnyat SMS options from env.
 */
export function taqnyatOptionsFromEnv(): ChannelOpenOptions {
  const bearerToken = process.env.TAQNYAT_BEARER_TOKEN?.trim() ?? process.env.TAQNYAT_TOKEN?.trim();
  const sender = process.env.TAQNYAT_SENDER?.trim();
  if (!bearerToken) {
    throw new Error("oke boot: taqnyat channel needs TAQNYAT_BEARER_TOKEN");
  }
  if (!sender) throw new Error("oke boot: taqnyat channel needs TAQNYAT_SENDER");
  return { bearerToken, sender };
}

/**
 * Resolve Taqnyat Email options from env.
 */
export function taqnyatMailOptionsFromEnv(): ChannelOpenOptions {
  const bearerToken = process.env.TAQNYAT_MAIL_TOKEN?.trim();
  const campaignName = process.env.TAQNYAT_CAMPAIGN?.trim();
  if (!bearerToken) throw new Error("oke boot: taqnyat-mail channel needs TAQNYAT_MAIL_TOKEN");
  if (!campaignName) throw new Error("oke boot: taqnyat-mail channel needs TAQNYAT_CAMPAIGN");
  return { bearerToken, campaignName };
}

/**
 * Resolve Msegat SMS options from env.
 */
export function msegatOptionsFromEnv(): ChannelOpenOptions {
  const userName = process.env.MSEGAT_USERNAME?.trim();
  const apiKey = process.env.MSEGAT_API_KEY?.trim();
  const sender = process.env.MSEGAT_SENDER?.trim();
  if (!userName) throw new Error("oke boot: msegat channel needs MSEGAT_USERNAME");
  if (!apiKey) throw new Error("oke boot: msegat channel needs MSEGAT_API_KEY");
  if (!sender) throw new Error("oke boot: msegat channel needs MSEGAT_SENDER");
  return { userName, apiKey, sender };
}

/**
 * Resolve Unifonic SMS options from env.
 */
export function unifonicOptionsFromEnv(): ChannelOpenOptions {
  const appSid = process.env.UNIFONIC_APPSID?.trim() ?? process.env.UNIFONIC_APP_SID?.trim();
  const sender = process.env.UNIFONIC_SENDER?.trim();
  if (!appSid) throw new Error("oke boot: unifonic channel needs UNIFONIC_APPSID");
  return { appSid, ...(sender ? { sender } : {}) };
}
