/**
 * Lazy channel binder — loaded only when Channel is declared.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { openConsoleChannel } from "../../drivers/channel-console.ts";
import { openSmtpChannel } from "../../drivers/channel-smtp.ts";
import type { ChannelDriver, ChannelOpenOptions } from "../../drivers/channel-types.ts";
import { createChannelRuntime, type ChannelRuntime } from "../../elements/channel.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct a Channel runtime (console inbox default).
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
    drivers: options.channel?.drivers ?? [channelDriverFor(options, env, docker)],
    now,
  });
}

function channelDriverFor(options: BootOptions, env: ConfigEnv, docker: boolean): ChannelDriver {
  const id = resolveEmailDriverId(options, env, docker);
  if (id === "console") return openConsoleChannel();
  if (id === "smtp") return openSmtpChannel(smtpOptionsFromEnv(docker));
  throw new Error(`oke boot: unknown email channel driver "${id}"`);
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
  return (
    resolveDriverId(options.config?.drivers?.channel?.email, env) ?? (docker ? "smtp" : "console")
  );
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
