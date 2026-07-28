/**
 * Lazy channel binder — loaded only when Channel is declared.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { openConsoleChannel } from "../../drivers/channel-console.ts";
import { openSmtpChannel } from "../../drivers/channel-smtp.ts";
import type { ChannelDriver } from "../../drivers/channel-types.ts";
import {
  createChannelRuntime,
  type ChannelRuntime,
} from "../../elements/channel.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct a Channel runtime.
 *
 * Defaults to the console inbox. Under docker (or when the email pin is
 * `smtp` and SMTP endpoint env is present), opens the SMTP transport against
 * Mailpit / real SMTP from compose env.
 *
 * @param options - Boot options
 * @param now - Clock
 * @param env - Active environment
 */
export function bindChannel(
  options: BootOptions,
  now: () => number,
  env: ConfigEnv = "local",
): ChannelRuntime {
  return createChannelRuntime({
    ...(options.channel ?? {}),
    drivers: options.channel?.drivers ?? defaultChannelDrivers(options, env),
    now,
  });
}

/**
 * Resolve default channel drivers from config + env.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
function defaultChannelDrivers(
  options: BootOptions,
  env: ConfigEnv,
): ChannelDriver[] {
  const emailId =
    resolveDriverId(options.config?.drivers?.channel?.email, env) ?? "console";
  if (emailId === "smtp") {
    const smtp = smtpOpenOptionsFromEnv();
    if (smtp) return [openSmtpChannel(smtp)];
    if (env === "docker" || env === "prod") {
      throw new Error(
        env === "docker"
          ? "oke boot: smtp channel needs OKE_CHANNEL_EMAIL_URL (did `oke dev -d` start Mailpit?)"
          : "oke boot: smtp channel needs OKE_CHANNEL_EMAIL_URL / SMTP_HOST",
      );
    }
  }
  return [openConsoleChannel()];
}

/**
 * Parse SMTP open options from compose / process env.
 */
function smtpOpenOptionsFromEnv():
  | { host: string; port?: number; user?: string; pass?: string }
  | undefined {
  const raw =
    process.env.OKE_CHANNEL_EMAIL_URL?.trim() ||
    process.env.SMTP_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      const host = u.hostname;
      if (!host) return undefined;
      const port = u.port ? Number(u.port) : undefined;
      const user = decodeURIComponent(u.username) || undefined;
      const pass = decodeURIComponent(u.password) || undefined;
      return {
        host,
        ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
        ...(user ? { user } : {}),
        ...(pass ? { pass } : {}),
      };
    } catch {
      /* fall through */
    }
  }
  const host =
    process.env.SMTP_HOST?.trim() ||
    process.env.OKE_CHANNEL_EMAIL_HOST?.trim();
  if (!host) return undefined;
  const portRaw =
    process.env.SMTP_PORT?.trim() ||
    process.env.OKE_CHANNEL_EMAIL_PORT?.trim();
  const port = portRaw ? Number(portRaw) : undefined;
  const user =
    process.env.SMTP_USER?.trim() ||
    process.env.OKE_CHANNEL_EMAIL_USER?.trim() ||
    undefined;
  const pass =
    process.env.SMTP_PASS?.trim() ||
    process.env.OKE_CHANNEL_EMAIL_PASSWORD?.trim() ||
    undefined;
  return {
    host,
    ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
  };
}
