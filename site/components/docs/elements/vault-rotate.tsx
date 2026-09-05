/**
 * Vault rotate physics — secret version (fresh DEK) vs master-key rewrap (KEK).
 *
 * Contrast cards share one tick: left bumps path version under a new data key;
 * right advances kekVersion and re-wraps DEKs — cleartext unchanged on both
 * until a value is supplied. Matches StoreKvTtl / GatePipeline quality.
 * Deterministic from one tick, never Math.random.
 */

"use client";

import { KeyRound, RefreshCw, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.yellow;
const ok = CHIP_TONE.emerald;

const TICK_MS = 1000;
const PHASES = ["idle", "rotate", "done"] as const;

/**
 * Version rotate vs master rotate — same vault, different keys.
 */
export function VaultRotate() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes the done beat. */
  const phase = tick === null ? 2 : tick % PHASES.length;
  const rotating = phase === 1;
  const done = phase === 2;

  const version = done || rotating ? 2 : 1;
  const kek = done || rotating ? 2 : 1;
  const versionLive = rotating || done;
  const masterLive = rotating || done;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Vault rotate physics: oke vault rotate writes a new secret version under a fresh data key; oke vault rotate-master advances the KEK and re-wraps every DEK. Cleartext stays the same until you pass a new value."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Rotate — version vs master</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fresh DEK · KEK rewrap
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        {PHASES.map((p, i) => (
          <PhaseChip key={p} label={p} live={phase === i} tick={tick} />
        ))}
        <span className="text-[11px] text-fd-muted-foreground">shared beat across both paths</span>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        <RotateCard
          icon={RefreshCw}
          title="secret version"
          syntax="oke vault rotate STRIPE_KEY"
          live={versionLive}
          rotating={rotating}
          tick={tick}
          rows={[
            { label: "path", value: "STRIPE_KEY" },
            {
              label: "version",
              value: `v${version}`,
              lit: versionLive,
              ping: rotating,
            },
            { label: "DEK", value: versionLive ? "fresh" : "current", lit: versionLive },
            { label: "cleartext", value: "unchanged*" },
          ]}
          detail="New version under a fresh data key. Pass a value to change what readers see; omit to re-encrypt only."
        />
        <RotateCard
          icon={KeyRound}
          title="master key"
          syntax="oke vault rotate-master"
          live={masterLive}
          rotating={rotating}
          tick={tick}
          rows={[
            { label: "kekVersion", value: `v${kek}`, lit: masterLive, ping: rotating },
            { label: "DEKs", value: masterLive ? "re-wrapped" : "wrapped", lit: masterLive },
            { label: "secrets", value: "same cleartext" },
            {
              label: "operator",
              value: done ? "store new master" : "·",
              lit: done,
              clear: true,
            },
          ]}
          detail="New KEK generation — every DEK re-wrapped. Print the new master once; update OKE_VAULT_MASTER_KEY."
        />
      </RevealGroup>
      <p className="border-t border-fd-border px-4 py-2 text-[11px] text-fd-muted-foreground sm:px-5">
        * Cleartext changes only when you pass a new value to{" "}
        <code className="font-mono text-[10px]">rotate</code> /{" "}
        <code className="font-mono text-[10px]">fx.vault.rotate</code>.
      </p>
    </figure>
  );
}

function PhaseChip({
  label,
  live,
  tick,
}: {
  readonly label: string;
  readonly live: boolean;
  readonly tick: number | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <code
        className={cn(
          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
          live ? tone.active : "border-fd-border text-fd-muted-foreground/50",
        )}
      >
        {label}
      </code>
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
        <span
          className={cn(
            "size-1.5 rounded-full transition-colors duration-300",
            live ? tone.hairline : "bg-fd-border",
          )}
        />
      </span>
    </div>
  );
}

function RotateCard({
  icon: Icon,
  title,
  syntax,
  live,
  rotating,
  tick,
  rows,
  detail,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly syntax: string;
  readonly live: boolean;
  readonly rotating: boolean;
  readonly tick: number | null;
  readonly rows: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly lit?: boolean;
    readonly ping?: boolean;
    readonly clear?: boolean;
  }>;
  readonly detail: string;
}) {
  return (
    <RevealItem
      as="li"
      lift
      className={cn(
        "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
        live ? tone.lit : "bg-fd-card",
      )}
    >
      <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
        <Icon
          className={cn("size-3", rotating ? tone.icon : "text-fd-muted-foreground")}
          aria-hidden
          strokeWidth={1.75}
        />
        {title}
      </code>
      <code className="font-mono text-[11px] text-fd-muted-foreground">{syntax}</code>

      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.label}
            className={cn(
              "flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-colors duration-300",
              row.lit
                ? row.clear
                  ? ok.active
                  : tone.active
                : "border-fd-border bg-fd-secondary/30",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="relative flex size-1.5 shrink-0" aria-hidden>
                {row.ping && tick !== null ? (
                  <BeatPing key={`${row.label}-${tick}`} className={tone.wash} />
                ) : null}
                <span
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-300",
                    row.lit ? (row.clear ? ok.hairline : tone.hairline) : "bg-fd-border",
                  )}
                />
              </span>
              <code className="font-mono text-[10px] text-fd-foreground">{row.label}</code>
            </span>
            <code
              className={cn(
                "shrink-0 font-mono text-[10px]",
                row.lit ? (row.clear ? ok.mark : tone.mark) : "text-fd-muted-foreground/60",
              )}
            >
              {row.value}
            </code>
          </li>
        ))}
      </ul>

      <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
        {detail}
      </p>
    </RevealItem>
  );
}
