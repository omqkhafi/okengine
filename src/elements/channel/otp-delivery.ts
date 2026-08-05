/**
 * Tier-2 OTP multi-medium delivery via sently {@link FallbackTransport}.
 *
 * Within each medium, {@link ChannelRuntime.send} already runs the existing
 * email/SMS FallbackTransport chains. This module reuses FallbackTransport
 * again for **cross-medium** provider-error failover — adapters normalize
 * per-medium sends to one options shape. Explicit user resend never calls
 * this chain; it delivers a single channel only.
 */

import { FallbackError, FallbackTransport } from "sently/transports/fallback";
import type { TaqnyatWhatsAppFailover } from "sently/transports/taqnyat-whatsapp";
import type { OtpChannel } from "../../auth/verification.ts";
import { hasWhatsAppSendWithFailover } from "../../drivers/channel-taqnyat-whatsapp.ts";
import type {
  ChannelAttempt,
  ChannelDriver,
  ChannelSendResult,
} from "../../drivers/channel-types.ts";

/** Minimal send surface used by OTP multi-medium delivery. */
export type OtpChannelSend = (
  template: string,
  options: {
    readonly to: string;
    readonly data?: Readonly<Record<string, unknown>>;
    readonly locale?: string;
  },
) => Promise<ChannelSendResult>;

/** Template names keyed by OTP channel. */
export type OtpTemplateMap = Readonly<Partial<Record<OtpChannel, string>>>;

/** Options for cross-medium OTP delivery. */
export interface DeliverOtpOptions {
  /** Preferred channel order (build-time declaration). */
  readonly channels: readonly OtpChannel[];
  /** Template name per medium. */
  readonly templates: OtpTemplateMap;
  readonly email?: string;
  readonly phone?: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  /**
   * When set, deliver **only** this channel (explicit resend) — no
   * cross-medium FallbackTransport walk.
   */
  readonly only?: OtpChannel;
}

/** Result of a Tier-2 OTP delivery attempt. */
export interface DeliverOtpResult {
  readonly ok: true;
  readonly channel: OtpChannel;
  readonly attempts: readonly ChannelAttempt[];
  readonly messageId: string;
  readonly driverId: string;
}

type MediumSendOpts = {
  readonly channel: OtpChannel;
  readonly to: string;
  readonly template: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly locale?: string;
};

type MediumSendResult = {
  readonly messageId: string;
  readonly status: string;
  readonly provider: string;
  readonly channel: OtpChannel;
};

/**
 * Whether an error should advance to the next transport / medium
 * (provider outage), not permanent client mistakes (invalid address).
 *
 * Shared by OTP cross-medium delivery and same-medium email/SMS
 * {@link FallbackTransport} chains on the Channel runtime.
 *
 * @param error - Thrown error
 */
export function shouldFallbackOtpMedium(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    /invalid.*(address|email|recipient|phone)|unknown user|no such user|mailbox unavailable|550 5\.1\.1/.test(
      msg,
    )
  ) {
    return false;
  }
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 400 || status === 401 || status === 403) return false;
  return true;
}

/**
 * Resolve the recipient address for a channel.
 *
 * @param channel - Medium
 * @param email - Email when present
 * @param phone - Phone when present
 */
export function addressForChannel(
  channel: OtpChannel,
  email: string | undefined,
  phone: string | undefined,
): string | undefined {
  if (channel === "email") return email;
  return phone;
}

/**
 * Deliver an OTP across declared channels using sently FallbackTransport.
 *
 * @param drivers - Bound drivers (for Taqnyat WhatsApp sendWithFailover)
 * @param send - ChannelRuntime.send bound function
 * @param opts - Delivery options
 * @param now - Clock
 */
export async function deliverOtpAcrossChannels(
  drivers: readonly ChannelDriver[],
  send: OtpChannelSend,
  opts: DeliverOtpOptions,
  now: () => number = () => Date.now(),
): Promise<DeliverOtpResult> {
  const ordered = opts.only ? [opts.only] : [...opts.channels];
  const adapters: Array<{
    readonly provider: string;
    send(o: MediumSendOpts): Promise<MediumSendResult>;
  }> = [];

  for (const channel of ordered) {
    const template = opts.templates[channel];
    const to = addressForChannel(channel, opts.email, opts.phone);
    if (!template || !to) continue;

    if (channel === "whatsapp" && !opts.only) {
      const wa = drivers.find((d) => hasWhatsAppSendWithFailover(d.whatsappTransport));
      if (wa && hasWhatsAppSendWithFailover(wa.whatsappTransport)) {
        const transport = wa.whatsappTransport;
        const failover = buildTaqnyatWhatsAppFailover(opts, ordered);
        if (failover.sms || failover.mail) {
          adapters.push({
            provider: "taqnyat-whatsapp",
            async send() {
              const result = await transport.sendWithFailover(
                { to, text: String(opts.data.otp ?? "") },
                failover,
              );
              return {
                messageId: result.messageId,
                status: result.status,
                provider: "taqnyat-whatsapp",
                channel: "whatsapp" as const,
              };
            },
          });
          // Provider-side failover already covers later sms/email — skip client adapters for those.
          break;
        }
      }
    }

    adapters.push({
      provider: channel,
      async send() {
        const result = await send(template, {
          to,
          data: opts.data,
          ...(opts.locale ? { locale: opts.locale } : {}),
        });
        if (!result.ok) {
          const errMsg =
            result.attempts
              .map((a) => a.error)
              .filter(Boolean)
              .join("; ") || `${channel} delivery failed`;
          const err = new Error(errMsg) as Error & { statusCode?: number };
          if (/invalid.*(address|email|recipient|phone)/i.test(errMsg)) {
            err.statusCode = 400;
          }
          throw err;
        }
        return {
          messageId: result.messageId,
          status: "sent",
          provider: result.driverId,
          channel,
        };
      },
    });
  }

  if (adapters.length === 0) {
    throw new Error(
      "channel: otp delivery has no viable channel — need a matching address for a declared channel",
    );
  }

  const attempts: ChannelAttempt[] = [];
  const fallback = new FallbackTransport(adapters, {
    shouldFallback: shouldFallbackOtpMedium,
    onFallback(failedIndex, error) {
      const provider = adapters[failedIndex]?.provider ?? `medium-${failedIndex}`;
      attempts.push({
        driverId: provider,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        at: now(),
      });
    },
  });

  try {
    const first = ordered.find((ch) => {
      const template = opts.templates[ch];
      const to = addressForChannel(ch, opts.email, opts.phone);
      return !!template && !!to;
    });
    if (!first) {
      throw new Error("channel: otp delivery has no viable channel");
    }
    const template = opts.templates[first]!;
    const to = addressForChannel(first, opts.email, opts.phone)!;
    const result = await fallback.send({
      channel: first,
      to,
      template,
      data: opts.data,
      ...(opts.locale ? { locale: opts.locale } : {}),
    });
    attempts.push({
      driverId: result.provider,
      ok: true,
      at: now(),
      messageId: result.messageId,
    });
    return {
      ok: true,
      channel: result.channel,
      attempts,
      messageId: result.messageId,
      driverId: result.provider,
    };
  } catch (err) {
    if (err instanceof FallbackError) {
      for (const a of err.attempts) {
        if (!attempts.some((x) => x.driverId === a.provider && !x.ok)) {
          attempts.push({
            driverId: a.provider,
            ok: false,
            error: a.error instanceof Error ? a.error.message : String(a.error),
            at: now(),
          });
        }
      }
      throw new Error(
        `channel: otp delivery failed on all channels (${err.attempts.map((a) => a.provider).join(" → ")})`,
      );
    }
    throw err;
  }
}

function buildTaqnyatWhatsAppFailover(
  opts: DeliverOtpOptions,
  ordered: readonly OtpChannel[],
): TaqnyatWhatsAppFailover {
  const waIndex = ordered.indexOf("whatsapp");
  const rest = waIndex >= 0 ? ordered.slice(waIndex + 1) : [];
  const otp = String(opts.data.otp ?? "");
  const sender = process.env.TAQNYAT_SENDER?.trim() ?? "";
  const campaign = process.env.TAQNYAT_CAMPAIGN?.trim() ?? "oke-otp";
  const out: TaqnyatWhatsAppFailover = {};
  if (rest.includes("sms") && opts.phone && sender) {
    out.sms = {
      sender,
      campaign,
      body: `Your sign-in code is: ${otp}`,
    };
  }
  if (rest.includes("email") && opts.email) {
    out.mail = {
      from: process.env.TAQNYAT_MAIL_FROM?.trim() ?? "OKE <no-reply@oke.local>",
      to: opts.email,
      campaign,
      subject: "Your sign-in code",
      msg: `Your one-time sign-in code is: ${otp}`,
    };
  }
  return out;
}
