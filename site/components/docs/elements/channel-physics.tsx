/**
 * Channel human physics — one fx.send walks consent → locale → drivers → receipt.
 *
 * Four scenarios cycle: a clean send, an opted-out suppression (drivers never
 * touch a provider), a catalog body fallback when the exact locale misses, and
 * same-medium driver failover (`via: ["smtp", "resend"]`) that lands status
 * `fallback`. Deterministic from one tick, never Math.random.
 */

"use client";

import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const STAGES: ReadonlyArray<{
  readonly id: "consent" | "locale" | "drivers";
  readonly title: string;
}> = [
  { id: "consent", title: "Consent" },
  { id: "locale", title: "Locale" },
  { id: "drivers", title: "Drivers" },
];

const SCENARIOS: ReadonlyArray<{
  readonly label: string;
  readonly consent: "ok" | "opted-out";
  readonly locale: string;
  readonly localeMark: string;
  readonly body: string;
  readonly attempts: ReadonlyArray<{ readonly driver: string; readonly ok: boolean }>;
  readonly status: "sent" | "fallback" | "suppressed/opted-out";
}> = [
  {
    label: "clean send",
    consent: "ok",
    locale: "en",
    localeMark: "default:en",
    body: "en",
    attempts: [{ driver: "smtp", ok: true }],
    status: "sent",
  },
  {
    label: "opted out",
    consent: "opted-out",
    locale: "en",
    localeMark: "default:en",
    body: "—",
    attempts: [],
    status: "suppressed/opted-out",
  },
  {
    label: "catalog miss",
    consent: "ok",
    locale: "ar-SA",
    localeMark: "profile:ar-SA",
    body: "en",
    attempts: [{ driver: "smtp", ok: true }],
    status: "sent",
  },
  {
    label: "driver failover",
    consent: "ok",
    locale: "en",
    localeMark: "default:en",
    body: "en",
    attempts: [
      { driver: "smtp", ok: false },
      { driver: "resend", ok: true },
    ],
    status: "fallback",
  },
];

const TICK_MS = 900;
const BEATS_PER_RUN = 4;

const tone = CHIP_TONE.cyan;
const pass = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

const CHIP = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Consent, locale, same-medium via, receipt — built into every send.
 */
export function ChannelPhysics() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes the completed driver-failover run — the non-obvious claim. */
  const t = tick ?? 3 * BEATS_PER_RUN + (BEATS_PER_RUN - 1);
  const run = Math.floor(t / BEATS_PER_RUN);
  const beat = t % BEATS_PER_RUN;
  const scenario = SCENARIOS[run % SCENARIOS.length]!;
  const suppressed = scenario.consent === "opted-out";
  const outcomeLive = beat === BEATS_PER_RUN - 1;
  const outcomeTone = scenario.status === "suppressed/opted-out" ? fail : pass;

  return (
    <figure
      className="not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Channel physics around one fx.send: consent can suppress before any provider; locale resolves then the catalog body falls back to the default or en; via orders same-medium driver ids with first success winning; every attempt lands on a receipt, with status fallback after recovery."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Around one fx.send</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          {'via: ["smtp", "resend"]'}
        </code>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-fd-border px-4 py-2 sm:px-5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
          scenario
        </span>
        <code className="font-mono text-[11px] text-fd-foreground">{scenario.label}</code>
      </div>

      <RevealGroup as="ol" className="flex flex-col gap-px bg-fd-border">
        {STAGES.map((stage, i) => {
          const probing =
            beat < 3 &&
            (suppressed
              ? (stage.id === "consent" && beat === 0) || (stage.id === "locale" && beat === 1)
              : i === beat);

          const consentDone = beat > 0;
          const localeDone = beat > 1;
          const driversDone = suppressed ? beat > 1 : beat > 2;
          const settled =
            stage.id === "consent" ? consentDone : stage.id === "locale" ? localeDone : driversDone;
          const skipped = suppressed && stage.id === "drivers" && settled;

          let mark = "·";
          let markTone = "opacity-0";
          let detail = "";
          let rowClass = "bg-fd-card";

          if (stage.id === "consent") {
            detail =
              scenario.consent === "ok"
                ? "not suppressed — provider may be contacted"
                : "opted-out — provider never touched";
            if (settled) {
              if (scenario.consent === "ok") {
                mark = "✓ allow";
                markTone = pass.mark;
                rowClass = pass.lit;
              } else {
                mark = "✗ suppress";
                markTone = fail.mark;
                rowClass = fail.lit;
              }
            } else if (probing) {
              rowClass = "bg-fd-secondary/40";
            }
          } else if (stage.id === "locale") {
            detail =
              scenario.body === "—"
                ? `${scenario.localeMark} — recorded on the receipt`
                : scenario.body === scenario.locale
                  ? `${scenario.localeMark} → body ${scenario.body}`
                  : `${scenario.localeMark} → body ${scenario.body} (catalog miss)`;
            if (settled) {
              mark = suppressed ? scenario.localeMark : `✓ ${scenario.locale}`;
              markTone = suppressed ? "text-fd-muted-foreground/60" : pass.mark;
              rowClass = suppressed ? "bg-fd-card" : pass.lit;
            } else if (probing) {
              rowClass = "bg-fd-secondary/40";
            }
          } else {
            detail = suppressed
              ? "skipped — suppression short-circuits"
              : scenario.attempts.length > 1
                ? "via order — first success wins"
                : `${scenario.attempts[0]?.driver ?? "smtp"} — single attempt`;
            if (skipped) {
              mark = "skipped";
              markTone = "text-fd-muted-foreground/40";
              rowClass = "bg-fd-card";
            } else if (settled) {
              mark = scenario.status === "fallback" ? "✓ recovered" : "✓ delivered";
              markTone = pass.mark;
              rowClass = pass.lit;
            } else if (probing) {
              rowClass = "bg-fd-secondary/40";
            }
          }

          return (
            <RevealItem
              as="li"
              key={stage.id}
              className={cn(
                "flex min-w-0 flex-col gap-1 px-4 py-2.5 transition-colors duration-300 sm:px-5",
                rowClass,
              )}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="relative flex w-5 shrink-0 items-center gap-1.5">
                  <span className="font-mono text-[10px] text-fd-muted-foreground/70">{i + 1}</span>
                  {probing && tick !== null ? (
                    <span className="relative flex size-1.5" aria-hidden>
                      <BeatPing key={t} className={tone.wash} />
                      <span className={cn("size-1.5 rounded-full", tone.hairline)} />
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-medium text-fd-foreground">{stage.title}</span>
                <span
                  aria-hidden
                  className={cn(
                    "ml-auto font-mono text-[10px] transition-opacity duration-300",
                    settled || skipped ? markTone : "opacity-0",
                  )}
                >
                  {mark}
                </span>
              </div>
              <p className="ps-8 text-[11px] text-pretty text-fd-muted-foreground">{detail}</p>
              {stage.id === "drivers" && settled && !skipped && scenario.attempts.length > 0 ? (
                <p className="flex flex-wrap items-center gap-1 ps-8" aria-hidden>
                  {scenario.attempts.map((a) => (
                    <code key={a.driver} className={cn(CHIP, a.ok ? pass.idle : fail.idle)}>
                      {a.driver} {a.ok ? "✓" : "✗"}
                    </code>
                  ))}
                </p>
              ) : null}
            </RevealItem>
          );
        })}
        <RevealItem
          as="li"
          className={cn(
            "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
            outcomeLive ? outcomeTone.lit : "bg-fd-secondary/50",
          )}
        >
          <span className="w-5 shrink-0 font-mono text-[10px] text-fd-muted-foreground/70">→</span>
          <p className="min-w-0 text-xs font-medium text-fd-foreground">
            {scenario.status === "suppressed/opted-out"
              ? "Receipt recorded — correct outcome, not a bug"
              : scenario.status === "fallback"
                ? "Receipt keeps every attempt; status is fallback"
                : "Receipt — driver, ok/error, timestamp, message id"}
          </p>
          <span
            aria-hidden
            className={cn(
              "ml-auto font-mono text-[10px] transition-opacity duration-300",
              outcomeLive ? outcomeTone.mark : "opacity-0",
            )}
          >
            {scenario.status}
          </span>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}
