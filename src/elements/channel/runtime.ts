/**
 * Channel runtime — templates, consent, fallback chains, receipts.
 *
 * Email path uses sently {@link Transport} (MIME / attachments / retry /
 * error hierarchy via sently). Fallback chains record every attempt.
 */

import {
  FallbackTransport,
  type FallbackAttempt,
  type Transport,
} from "sently";
import { RetryTransport } from "sently/transports/retry";
import type {
  ChannelAttempt,
  ChannelDriver,
  ChannelMessage,
  ChannelSendResult,
} from "../../drivers/channel-types.ts";
import type { ChannelMedium } from "../../manifest/types.ts";
import type { ChannelTemplateDecl } from "./declare.ts";
import {
  createConsentStore,
  type ConsentStore,
} from "./consent.ts";
import {
  createReceiptLedger,
  type DeliveryReceipt,
  type ReceiptLedger,
} from "./receipts.ts";

/** Locale catalog: template → locale → rendered body. */
export type TemplateCatalog = Readonly<
  Record<
    string,
    Readonly<
      Record<
        string,
        { readonly subject?: string; readonly text?: string; readonly html?: string }
      >
    >
  >
>;

/** Options for {@link createChannelRuntime}. */
export interface CreateChannelRuntimeOptions {
  /** Declared templates. */
  readonly templates?: readonly ChannelTemplateDecl[];
  /**
   * Ordered drivers for fallback. First success wins; every attempt is recorded.
   */
  readonly drivers?: readonly ChannelDriver[];
  /** i18n body catalog. */
  readonly catalog?: TemplateCatalog;
  /** Default locale. */
  readonly defaultLocale?: string;
  /** Consent store (created if omitted). */
  readonly consent?: ConsentStore;
  /** Receipt ledger (created if omitted). */
  readonly receipts?: ReceiptLedger;
  /** Wrap email transports with sently RetryTransport. */
  readonly retry?: boolean;
  /** Injectable clock. */
  readonly now?: () => number;
}

/** Send options for {@link ChannelRuntime.send}. */
export interface ChannelSendOptions {
  readonly to: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  readonly via?: readonly string[];
  readonly subject?: string;
  readonly pushSubscription?: ChannelMessage["pushSubscription"];
}

/** Channel runtime surface. */
export interface ChannelRuntime {
  readonly templates: ReadonlyMap<string, ChannelTemplateDecl>;
  readonly consent: ConsentStore;
  readonly receipts: ReceiptLedger;
  /**
   * Send a template through the driver chain.
   *
   * @param template - Template name
   * @param options - Recipient / data / locale / via
   */
  send(
    template: string,
    options: ChannelSendOptions,
  ): Promise<ChannelSendResult>;
}

/**
 * Create a Channel runtime.
 *
 * @param options - Templates + drivers + catalog
 */
export function createChannelRuntime(
  options: CreateChannelRuntimeOptions = {},
): ChannelRuntime {
  const templates = new Map<string, ChannelTemplateDecl>();
  for (const t of options.templates ?? []) {
    templates.set(t.name, t);
  }
  const consent = options.consent ?? createConsentStore();
  const receipts = options.receipts ?? createReceiptLedger();
  const catalog = options.catalog ?? {};
  const defaultLocale = options.defaultLocale ?? "en";
  const now = options.now ?? (() => Date.now());
  const drivers = [...(options.drivers ?? [])];

  function resolveBody(
    template: string,
    locale: string,
    data: Readonly<Record<string, unknown>>,
  ): { subject?: string; text?: string; html?: string } {
    const byLocale = catalog[template];
    const entry =
      byLocale?.[locale] ?? byLocale?.[defaultLocale] ?? byLocale?.en;
    if (!entry) {
      return {
        subject: template,
        text: JSON.stringify(data),
      };
    }
    const interpolate = (s: string | undefined): string | undefined => {
      if (s === undefined) return undefined;
      return s.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(data[key] ?? ""),
      );
    };
    return {
      subject: interpolate(entry.subject),
      text: interpolate(entry.text),
      html: interpolate(entry.html),
    };
  }

  function driversFor(
    medium: ChannelMedium,
    via?: readonly string[],
  ): ChannelDriver[] {
    let list = drivers;
    if (via && via.length > 0) {
      list = via
        .map((id) => drivers.find((d) => d.id === id || d.transport?.provider === id))
        .filter((d): d is ChannelDriver => d !== undefined);
    }
    return list.filter((d) => {
      if (medium === "email" || medium === "any") {
        return !!d.transport || d.channel?.mediums.includes(medium) ||
          d.channel?.mediums.includes("any");
      }
      return (
        d.channel?.mediums.includes(medium) ||
        d.channel?.mediums.includes("any")
      );
    });
  }

  async function sendViaEmailChain(
    chain: ChannelDriver[],
    mail: Parameters<Transport["send"]>[0],
  ): Promise<{ result: ChannelSendResult; attempts: ChannelAttempt[] }> {
    const attempts: ChannelAttempt[] = [];
    const transports: Transport[] = [];
    for (const d of chain) {
      if (!d.transport) continue;
      const t = options.retry
        ? new RetryTransport(d.transport)
        : d.transport;
      transports.push(t);
    }
    if (transports.length === 0) {
      throw new Error("channel: no email transport in driver chain");
    }

    const recorded: FallbackAttempt[] = [];
    const fallback = new FallbackTransport(transports, {
      onFallback(failedIndex, error) {
        const provider =
          transports[failedIndex]?.provider ??
          chain[failedIndex]?.id ??
          `driver-${failedIndex}`;
        recorded.push({ provider, error });
        attempts.push({
          driverId: provider,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          at: now(),
        });
      },
    });

    try {
      const mailResult = await fallback.send(mail);
      const driverId =
        mailResult.provider ??
        transports[mailResult.providerIndex ?? 0]?.provider ??
        chain[0]?.id ??
        "email";
      attempts.push({
        driverId,
        ok: true,
        at: now(),
        messageId: mailResult.messageId,
      });
      // Ensure failed attempts before success are present when FallbackTransport
      // short-circuits without calling onFallback in some paths.
      return {
        result: {
          ok: true,
          messageId: mailResult.messageId,
          driverId,
          attempts,
          mail: mailResult,
        },
        attempts,
      };
    } catch (err) {
      // FallbackError carries all attempts
      const fbAttempts =
        err &&
        typeof err === "object" &&
        "attempts" in err &&
        Array.isArray((err as { attempts: FallbackAttempt[] }).attempts)
          ? (err as { attempts: FallbackAttempt[] }).attempts
          : recorded;
      for (const a of fbAttempts) {
        if (!attempts.some((x) => x.driverId === a.provider && !x.ok)) {
          attempts.push({
            driverId: a.provider,
            ok: false,
            error: a.error instanceof Error ? a.error.message : String(a.error),
            at: now(),
          });
        }
      }
      return {
        result: {
          ok: false,
          messageId: crypto.randomUUID(),
          driverId: "fallback",
          attempts,
        },
        attempts,
      };
    }
  }

  async function sendViaChannelChain(
    chain: ChannelDriver[],
    message: ChannelMessage,
  ): Promise<{ result: ChannelSendResult; attempts: ChannelAttempt[] }> {
    const attempts: ChannelAttempt[] = [];
    for (const d of chain) {
      if (!d.channel) continue;
      try {
        const r = await d.channel.send(message);
        attempts.push(...r.attempts);
        if (r.ok) {
          return {
            result: { ...r, attempts: [...attempts] },
            attempts,
          };
        }
      } catch (err) {
        attempts.push({
          driverId: d.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          at: now(),
        });
      }
    }
    return {
      result: {
        ok: false,
        messageId: crypto.randomUUID(),
        driverId: "fallback",
        attempts,
      },
      attempts,
    };
  }

  return {
    templates,
    consent,
    receipts,
    async send(template, opts) {
      const decl = templates.get(template);
      if (!decl) {
        throw new Error(`channel: unknown template "${template}"`);
      }
      const medium = decl.medium;
      if (consent.isOptedOut(opts.to, medium === "any" ? "email" : medium)) {
        const receipt: DeliveryReceipt = {
          id: crypto.randomUUID(),
          template,
          to: opts.to,
          medium,
          locale: opts.locale,
          status: "opted-out",
          attempts: [],
          at: now(),
          error: "opted out",
        };
        receipts.record(receipt);
        return {
          ok: false,
          messageId: receipt.id,
          driverId: "consent",
          attempts: [],
        };
      }

      const locale = opts.locale ?? defaultLocale;
      const body = resolveBody(template, locale, opts.data ?? {});
      const chain = driversFor(medium, opts.via);

      let result: ChannelSendResult;
      let attempts: ChannelAttempt[];

      if (medium === "email" || (medium === "any" && chain.some((d) => d.transport))) {
        const from = decl.from ?? "oke@localhost";
        const sendResult = await sendViaEmailChain(chain, {
          from,
          to: opts.to,
          subject: opts.subject ?? body.subject ?? template,
          text: body.text,
          html: body.html,
          template,
          data: opts.data ? { ...opts.data } : undefined,
        });
        result = sendResult.result;
        attempts = sendResult.attempts;
      } else {
        const sendResult = await sendViaChannelChain(chain, {
          medium: medium === "any" ? "sms" : medium,
          to: opts.to,
          from: decl.from,
          subject: opts.subject ?? body.subject,
          text: body.text,
          html: body.html,
          data: opts.data,
          locale,
          template,
          pushSubscription: opts.pushSubscription,
        });
        result = sendResult.result;
        attempts = sendResult.attempts;
      }

      const status: DeliveryReceipt["status"] = result.ok
        ? attempts.filter((a) => !a.ok).length > 0
          ? "fallback"
          : "sent"
        : "failed";

      receipts.record({
        id: crypto.randomUUID(),
        template,
        to: opts.to,
        medium,
        locale,
        status,
        messageId: result.messageId,
        driverId: result.driverId,
        attempts,
        at: now(),
        ...(result.ok
          ? {}
          : {
              error: attempts.map((a) => a.error).filter(Boolean).join("; "),
            }),
      });

      return { ...result, attempts };
    },
  };
}
