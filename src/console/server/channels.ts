/**
 * Console Channel projection — Manifest + ChannelRuntime (console §9.9).
 *
 * The UI must not recompute delivery state from raw provider webhooks.
 */

import { promises as dns } from "node:dns";
import { openConsoleChannel } from "../../drivers/channel-console.ts";
import {
  createChannelInbox,
  type ChannelInbox,
  type ChannelInboxEntry,
} from "../../drivers/channel-types.ts";
import {
  buildOutcomeRows,
  channel as declareChannel,
  createChannelRuntime,
  fallbackWeeklyCostDelta,
  formatAttemptChain,
  isDeliveryOutcomeState,
  isRtlLocale,
  maskRecipient,
  resolveLocale,
  verifyEmailAuth,
  type ChannelRuntime,
  type DeliveryOutcomeState,
  type DeliveryReceipt,
  type DeliveryVerdict,
  type EmailAuthResult,
  type OutcomeRow,
  type SuppressionEntry,
  type TemplateCatalog,
} from "../../elements/channel.ts";
import type { Manifest } from "../../manifest/types.ts";

export { createChannelInbox, openConsoleChannel };

/** Panel face — inbox in dev, deliverability in prod. */
export type ChannelsFace = "inbox" | "deliverability";

/** One Manifest template row. */
export interface ConsoleChannelTemplate {
  readonly name: string;
  readonly medium: string;
  readonly locales: readonly string[];
  readonly from: string | null;
  readonly schema: unknown;
}

/** Masked inbox entry for the dev face. */
export interface ConsoleInboxRow {
  readonly id: string;
  readonly medium: string;
  readonly toMasked: string;
  readonly subject: string | null;
  readonly text: string | null;
  readonly html: string | null;
  readonly template: string | null;
  readonly locale: string | null;
  readonly at: number;
}

/** Masked receipt row. */
export interface ConsoleReceiptRow {
  readonly id: string;
  readonly template: string;
  readonly toMasked: string;
  readonly medium: string;
  readonly locale: string | null;
  readonly localeChain: readonly string[];
  readonly status: string;
  readonly chain: string;
  readonly messageId: string | null;
  readonly at: number;
  readonly error: string | null;
}

/** Masked suppression row. */
export interface ConsoleSuppressionRow {
  readonly subjectMasked: string;
  readonly medium: string;
  readonly reason: "opted-out" | "prior-bounce";
  readonly at: number;
}

/** Fallback financial metric for one template (or all). */
export interface ConsoleFallbackMetric {
  readonly template: string | null;
  readonly chainExample: string;
  readonly fallbackRate: number;
  readonly fallbackCount: number;
  readonly totalCount: number;
  readonly weeklyDeltaUsd: number;
  readonly primaryMedium: string;
  readonly fallbackMedium: string;
  readonly summary: string;
}

/** Full Channels panel projection. */
export interface ConsoleChannelsList {
  readonly face: ChannelsFace;
  readonly production: boolean;
  readonly templates: readonly ConsoleChannelTemplate[];
  readonly outcomes: readonly OutcomeRow[];
  readonly fallback: ConsoleFallbackMetric;
  readonly inbox: readonly ConsoleInboxRow[];
  readonly receipts: readonly ConsoleReceiptRow[];
  readonly suppression: readonly ConsoleSuppressionRow[];
}

/** Preview of a template body for a locale. */
export interface ConsoleChannelPreview {
  readonly template: string;
  readonly locale: string;
  readonly localeChain: readonly string[];
  readonly dir: "ltr" | "rtl";
  readonly subject: string | null;
  readonly text: string | null;
  readonly html: string | null;
}

/** Options for projecting the channels list. */
export interface ProjectChannelsOptions {
  readonly manifest: Manifest | null;
  readonly runtime: ChannelRuntime | null;
  readonly inbox: ChannelInbox | null;
  readonly production: boolean;
  readonly now: () => number;
  readonly catalog?: TemplateCatalog;
  readonly revealPii?: boolean;
}

/**
 * Project operator-plane Channels panel data from Manifest + runtime.
 *
 * @param options - Manifest, runtime, inbox, env
 */
export function projectChannelsList(
  options: ProjectChannelsOptions,
): ConsoleChannelsList {
  const face: ChannelsFace = options.production ? "deliverability" : "inbox";
  const templates = projectTemplates(options.manifest);
  const receipts = options.runtime?.receipts.all() ?? [];
  const counts: Partial<Record<DeliveryOutcomeState, number>> = {};
  for (const r of receipts) {
    if (isDeliveryOutcomeState(r.status)) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
  }
  const outcomes = buildOutcomeRows(counts);
  const weekStart = options.now() - 7 * 86_400_000;
  const delta = fallbackWeeklyCostDelta(receipts, {
    weekStartMs: weekStart,
    now: options.now(),
    costs: options.runtime?.costs,
  });
  const chainExample =
    receipts
      .filter((r) => r.status === "fallback" && r.attempts.length > 0)
      .map((r) => formatAttemptChain(r.attempts))
      .find(Boolean) ??
    (delta.fallbackCount > 0
      ? `${delta.primaryMedium} failed → ${delta.fallbackMedium} succeeded`
      : "");

  const fallback: ConsoleFallbackMetric = {
    template: null,
    chainExample,
    fallbackRate: delta.fallbackRate,
    fallbackCount: delta.fallbackCount,
    totalCount: delta.totalCount,
    weeklyDeltaUsd: delta.weeklyDeltaUsd,
    primaryMedium: delta.primaryMedium,
    fallbackMedium: delta.fallbackMedium,
    summary: formatFallbackSummary(delta),
  };

  const reveal = options.revealPii === true;
  return {
    face,
    production: options.production,
    templates,
    outcomes,
    fallback,
    inbox: projectInbox(options.inbox?.entries ?? [], reveal),
    receipts: projectReceipts(receipts, reveal),
    suppression: projectSuppression(
      options.runtime?.suppression.list() ?? [],
      reveal,
    ),
  };
}

/**
 * Format the weekly fallback cost line for the panel.
 *
 * @param delta - Weekly cost projection
 */
export function formatFallbackSummary(delta: {
  readonly fallbackRate: number;
  readonly weeklyDeltaUsd: number;
  readonly primaryMedium: string;
}): string {
  const pct = Math.round(delta.fallbackRate * 100);
  const dollars = Math.abs(delta.weeklyDeltaUsd);
  const signed =
    delta.weeklyDeltaUsd >= 0
      ? `$${dollars.toFixed(dollars >= 1 ? 0 : 2)}`
      : `-$${dollars.toFixed(dollars >= 1 ? 0 : 2)}`;
  return `${pct}% fell back · ${signed} / week above ${delta.primaryMedium}-only`;
}

/**
 * Project Manifest channel templates.
 *
 * @param manifest - Manifest snapshot
 */
export function projectTemplates(
  manifest: Manifest | null,
): readonly ConsoleChannelTemplate[] {
  return Object.entries(manifest?.channels ?? {})
    .map(([name, c]) => ({
      name,
      medium: c.medium ?? "email",
      locales: c.locales ?? [],
      from: c.from ?? null,
      schema: c.schema ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Preview a template body with locale chain + RTL dir.
 *
 * @param options - Runtime + template + locale inputs
 */
export function previewChannelTemplate(options: {
  readonly runtime: ChannelRuntime | null;
  readonly manifest: Manifest | null;
  readonly catalog?: TemplateCatalog;
  readonly template: string;
  readonly locale?: string;
  readonly profileLocale?: string;
  readonly acceptLanguage?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly defaultLocale?: string;
}): ConsoleChannelPreview {
  const defaultLocale = options.defaultLocale ?? "en";
  const resolved = resolveLocale({
    locale: options.locale,
    profileLocale: options.profileLocale,
    acceptLanguage: options.acceptLanguage,
    defaultLocale,
  });
  const catalog = options.catalog ?? {};
  const byLocale = catalog[options.template];
  const entry =
    byLocale?.[resolved.locale] ??
    byLocale?.[defaultLocale] ??
    byLocale?.en;
  const data = options.data ?? sampleDataFromSchema(
    options.manifest?.channels?.[options.template]?.schema,
  );
  const interpolate = (s: string | undefined): string | null => {
    if (s === undefined) return null;
    return s.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
      String(data[key] ?? `{{${key}}}`),
    );
  };
  return {
    template: options.template,
    locale: resolved.locale,
    localeChain: [...resolved.chain],
    dir: isRtlLocale(resolved.locale) ? "rtl" : "ltr",
    subject: interpolate(entry?.subject),
    text: interpolate(entry?.text) ?? (entry ? null : JSON.stringify(data)),
    html: interpolate(entry?.html),
  };
}

/**
 * Verify SPF/DKIM/DMARC for a template's From domain.
 *
 * @param fromOrDomain - From address or domain
 * @param lookup - Optional DNS TXT lookup (defaults to system DNS)
 */
export async function verifyChannelAuth(
  fromOrDomain: string,
  lookup?: (name: string) => Promise<readonly string[]>,
): Promise<EmailAuthResult> {
  return verifyEmailAuth(fromOrDomain, {
    lookup:
      lookup ??
      (async (name) => {
        try {
          const records = await dns.resolveTxt(name);
          return records.map((parts) => parts.join(""));
        } catch {
          return [];
        }
      }),
  });
}

/**
 * Reveal a cleartext recipient from a receipt / inbox id (audited upstream).
 *
 * @param options - Runtime + inbox + id
 */
export function revealChannelRecipient(options: {
  readonly runtime: ChannelRuntime | null;
  readonly inbox: ChannelInbox | null;
  readonly id: string;
}): { readonly id: string; readonly to: string } | null {
  const receipt = options.runtime?.receipts.all().find((r) => r.id === options.id);
  if (receipt) return { id: receipt.id, to: receipt.to };
  const entry = options.inbox?.entries.find((e) => e.id === options.id);
  if (entry) return { id: entry.id, to: entry.to };
  const suppressed = options.runtime?.suppression
    .list()
    .find((s) => maskRecipient(s.subject) === options.id || s.subject === options.id);
  if (suppressed) return { id: options.id, to: suppressed.subject };
  return null;
}

/**
 * Send a real test message through the Channel runtime (never dry-run).
 *
 * @param runtime - Channel runtime
 * @param input - Template + recipient
 */
export async function sendChannelTest(
  runtime: ChannelRuntime,
  input: {
    readonly template: string;
    readonly to: string;
    readonly locale?: string;
    readonly data?: Readonly<Record<string, unknown>>;
  },
): Promise<{
  readonly ok: boolean;
  readonly messageId: string;
  readonly status: string;
  readonly chain: string;
}> {
  const result = await runtime.send(input.template, {
    to: input.to,
    locale: input.locale,
    data: input.data,
  });
  const receipt =
    runtime.receipts.byMessageId(result.messageId) ??
    runtime.receipts.all().at(-1);
  return {
    ok: result.ok,
    messageId: result.messageId,
    status: receipt?.status ?? (result.ok ? "sent" : "provider-error"),
    chain: formatAttemptChain(result.attempts),
  };
}

/**
 * Build a ChannelRuntime + shared inbox from the Manifest for Console.
 *
 * @param manifest - Manifest snapshot
 * @param options - Clock + catalog + production
 */
export function createManifestChannelRuntime(
  manifest: Manifest | null,
  options: {
    readonly now: () => number;
    readonly catalog?: TemplateCatalog;
    readonly inbox?: ChannelInbox;
  },
): { readonly runtime: ChannelRuntime; readonly inbox: ChannelInbox } {
  const inbox = options.inbox ?? createChannelInbox();
  const templates = Object.entries(manifest?.channels ?? {}).map(([name, c]) =>
    declareChannel.template(name, {
      medium: c.medium,
      locales: c.locales,
      schema: c.schema,
      from: c.from,
    }),
  );
  const runtime = createChannelRuntime({
    templates,
    drivers: [openConsoleChannel({ inbox })],
    catalog: options.catalog ?? {},
    now: options.now,
  });
  return { runtime, inbox };
}

function projectInbox(
  entries: readonly ChannelInboxEntry[],
  reveal: boolean,
): readonly ConsoleInboxRow[] {
  return [...entries]
    .sort((a, b) => b.at - a.at)
    .map((e) => ({
      id: e.id,
      medium: e.medium,
      toMasked: reveal ? e.to : maskRecipient(e.to),
      subject: e.subject ?? null,
      text: e.text ?? null,
      html: e.html ?? null,
      template: e.template ?? null,
      locale: e.locale ?? null,
      at: e.at,
    }));
}

function projectReceipts(
  receipts: readonly DeliveryReceipt[],
  reveal: boolean,
): readonly ConsoleReceiptRow[] {
  return [...receipts]
    .sort((a, b) => b.at - a.at)
    .slice(0, 200)
    .map((r) => ({
      id: r.id,
      template: r.template,
      toMasked: reveal ? r.to : maskRecipient(r.to),
      medium: r.medium,
      locale: r.locale ?? null,
      localeChain: r.localeChain ? [...r.localeChain] : [],
      status: r.status,
      chain: formatAttemptChain(r.attempts),
      messageId: r.messageId ?? null,
      at: r.at,
      error: r.error ?? null,
    }));
}

function projectSuppression(
  rows: readonly SuppressionEntry[],
  reveal: boolean,
): readonly ConsoleSuppressionRow[] {
  return rows.map((r) => ({
    subjectMasked: reveal ? r.subject : maskRecipient(r.subject),
    medium: r.medium,
    reason: r.reason,
    at: r.at,
  }));
}

function sampleDataFromSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props) return {};
  const data: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(props)) {
    const t = (def as { type?: string }).type;
    data[key] =
      t === "number" || t === "integer"
        ? 1
        : t === "boolean"
          ? true
          : `{{${key}}}`;
  }
  return data;
}

export type {
  DeliveryOutcomeState,
  DeliveryVerdict,
  EmailAuthResult,
  OutcomeRow,
};
