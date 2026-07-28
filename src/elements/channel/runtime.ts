/**
 * Channel runtime — templates, consent, fallback chains, receipts.
 *
 * Email path uses sently {@link Transport} (MIME / attachments / retry /
 * error hierarchy via sently). Fallback chains record every attempt.
 */

import { FallbackTransport, type FallbackAttempt, type Transport } from "sently";
import { RetryTransport } from "sently/transports/retry";
import type {
  ChannelAttempt,
  ChannelDriver,
  ChannelMessage,
  ChannelSendResult,
} from "../../drivers/channel-types.ts";
import type { ChannelMedium } from "../../manifest/types.ts";
import type { ConsentStore } from "./consent.ts";
import type { ChannelTemplateDecl } from "./declare.ts";
import { DEFAULT_MEDIUM_COSTS, type MediumCosts } from "./costs.ts";
import { resolveLocale, type LocaleChainStep } from "./locale.ts";
import type { DeliveryOutcomeState } from "./outcomes.ts";
import {
  createReceiptLedger,
  type DeliveryReceipt,
  type DeliveryStatus,
  type IngestOutcomeInput,
  type ReceiptLedger,
} from "./receipts.ts";
import { createSuppressionStore, type SuppressionStore } from "./suppression.ts";

/** Locale catalog: template → locale → rendered body. */
export type TemplateCatalog = Readonly<
  Record<
    string,
    Readonly<
      Record<string, { readonly subject?: string; readonly text?: string; readonly html?: string }>
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
  /** Suppression store (created if omitted). */
  readonly suppression?: SuppressionStore;
  /**
   * Consent store — wrapped into suppression when `suppression` is omitted.
   * Prefer {@link CreateChannelRuntimeOptions.suppression}.
   */
  readonly consent?: ConsentStore;
  /** Receipt ledger (created if omitted). */
  readonly receipts?: ReceiptLedger;
  /** Medium unit costs (USD / message). */
  readonly costs?: MediumCosts;
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
  readonly profileLocale?: string;
  readonly acceptLanguage?: string;
  readonly via?: readonly string[];
  readonly subject?: string;
  readonly pushSubscription?: ChannelMessage["pushSubscription"];
}

/** Channel runtime surface. */
export interface ChannelRuntime {
  readonly templates: ReadonlyMap<string, ChannelTemplateDecl>;
  readonly suppression: SuppressionStore;
  readonly receipts: ReceiptLedger;
  readonly costs: MediumCosts;
  /**
   * Send a template through the driver chain.
   *
   * @param template - Template name
   * @param options - Recipient / data / locale / via
   */
  send(template: string, options: ChannelSendOptions): Promise<ChannelSendResult>;
  /**
   * Ingest a post-send provider outcome (bounce / complaint / …).
   * Hard bounce auto-adds suppression. Console projects the ledger — never
   * raw webhooks.
   *
   * @param input - Normalized outcome
   */
  ingestOutcome(input: IngestOutcomeInput): DeliveryReceipt;
}

/**
 * Create a Channel runtime.
 *
 * @param options - Templates + drivers + catalog
 */
export function createChannelRuntime(options: CreateChannelRuntimeOptions = {}): ChannelRuntime {
  const templates = new Map<string, ChannelTemplateDecl>();
  for (const t of options.templates ?? []) {
    templates.set(t.name, t);
  }
  const suppression =
    options.suppression ??
    createSuppressionStore(options.consent ? { consent: options.consent } : {});
  const receipts = options.receipts ?? createReceiptLedger();
  const costs = options.costs ?? { ...DEFAULT_MEDIUM_COSTS };
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
    const entry = byLocale?.[locale] ?? byLocale?.[defaultLocale] ?? byLocale?.en;
    if (!entry) {
      return {
        subject: template,
        text: JSON.stringify(data),
      };
    }
    const interpolate = (s: string | undefined): string | undefined => {
      if (s === undefined) return undefined;
      return s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(data[key] ?? ""));
    };
    return {
      subject: interpolate(entry.subject),
      text: interpolate(entry.text),
      html: interpolate(entry.html),
    };
  }

  function driversFor(medium: ChannelMedium, via?: readonly string[]): ChannelDriver[] {
    let list = drivers;
    if (via && via.length > 0) {
      list = via
        .map((id) => drivers.find((d) => d.id === id || d.transport?.provider === id))
        .filter((d): d is ChannelDriver => d !== undefined);
    }
    return list.filter((d) => {
      if (medium === "email" || medium === "any") {
        return (
          !!d.transport || d.channel?.mediums.includes(medium) || d.channel?.mediums.includes("any")
        );
      }
      return d.channel?.mediums.includes(medium) || d.channel?.mediums.includes("any");
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
      const t = options.retry ? new RetryTransport(d.transport) : d.transport;
      transports.push(t);
    }
    if (transports.length === 0) {
      throw new Error("channel: no email transport in driver chain");
    }

    const recorded: FallbackAttempt[] = [];
    const fallback = new FallbackTransport(transports, {
      onFallback(failedIndex, error) {
        const provider =
          transports[failedIndex]?.provider ?? chain[failedIndex]?.id ?? `driver-${failedIndex}`;
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

  function classifySendFailure(attempts: readonly ChannelAttempt[]): DeliveryOutcomeState {
    const err = attempts
      .map((a) => a.error ?? "")
      .join(" ")
      .toLowerCase();
    if (
      /invalid.*(address|email|recipient)|unknown user|no such user|mailbox unavailable|550 5\.1\.1/.test(
        err,
      )
    ) {
      return "blocked/invalid-address";
    }
    return "provider-error";
  }

  return {
    templates,
    suppression,
    receipts,
    costs,
    ingestOutcome(input) {
      const at = input.at ?? now();
      const existing = receipts.byMessageId(input.messageId);
      if (input.state === "hard-bounce") {
        const subject = input.to ?? existing?.to;
        const medium = (input.medium ?? existing?.medium ?? "email") as ChannelMedium;
        if (subject) {
          suppression.addPriorBounce(subject, medium === "any" ? "email" : medium);
        }
      }

      if (existing) {
        const updated = receipts.updateStatus(input.messageId, {
          status: input.state,
          at,
          error: input.error,
        });
        return updated ?? existing;
      }

      const receipt: DeliveryReceipt = {
        id: crypto.randomUUID(),
        template: input.template ?? "unknown",
        to: input.to ?? "unknown",
        medium: input.medium ?? "email",
        status: input.state,
        messageId: input.messageId,
        attempts: [],
        at,
        ...(input.error !== undefined ? { error: input.error } : {}),
      };
      receipts.record(receipt);
      return receipt;
    },
    async send(template, opts) {
      const decl = templates.get(template);
      if (!decl) {
        throw new Error(`channel: unknown template "${template}"`);
      }
      const medium = decl.medium;
      const checkMedium: ChannelMedium = medium === "any" ? "email" : medium;

      const suppressed = suppression.isSuppressed(opts.to, checkMedium);
      if (suppressed.suppressed) {
        const status: DeliveryStatus =
          suppressed.reason === "opted-out" ? "suppressed/opted-out" : "suppressed/prior-bounce";
        const resolved = resolveLocale({
          locale: opts.locale,
          profileLocale: opts.profileLocale,
          acceptLanguage: opts.acceptLanguage,
          defaultLocale,
        });
        const receipt: DeliveryReceipt = {
          id: crypto.randomUUID(),
          template,
          to: opts.to,
          medium,
          locale: resolved.locale,
          localeChain: resolved.chain,
          status,
          attempts: [],
          at: now(),
          error: suppressed.reason === "opted-out" ? "opted out" : "prior hard bounce",
        };
        receipts.record(receipt);
        return {
          ok: false,
          messageId: receipt.id,
          driverId: "suppression",
          attempts: [],
        };
      }

      const resolved = resolveLocale({
        locale: opts.locale,
        profileLocale: opts.profileLocale,
        acceptLanguage: opts.acceptLanguage,
        defaultLocale,
      });
      const locale = resolved.locale;
      const localeChain: readonly LocaleChainStep[] = resolved.chain;
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

      let status: DeliveryStatus;
      if (result.ok) {
        status = attempts.filter((a) => !a.ok).length > 0 ? "fallback" : "sent";
      } else {
        status = classifySendFailure(attempts);
      }

      receipts.record({
        id: crypto.randomUUID(),
        template,
        to: opts.to,
        medium,
        locale,
        localeChain,
        status,
        messageId: result.messageId,
        driverId: result.driverId,
        attempts,
        at: now(),
        ...(result.ok
          ? {}
          : {
              error: attempts
                .map((a) => a.error)
                .filter(Boolean)
                .join("; "),
            }),
      });

      return { ...result, attempts };
    },
  };
}
