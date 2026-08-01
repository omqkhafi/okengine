/**
 * Manifest pipeline — Code → manifest.oke.json → derived surfaces.
 *
 * Desktop: living SVG wiring diagram (packets ride the spine). Mobile: honest
 * stacked stage cards. Icons + tone badges make each hop scannable.
 */

import {
  BookOpen,
  Boxes,
  Braces,
  Container,
  FileJson2,
  KeyRound,
  LayoutDashboard,
  Network,
  ShieldCheck,
  Terminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  DERIVED_SURFACE_GROUPS,
  DERIVED_SURFACES,
  MANIFEST_FLOW_KEYS,
  MANIFEST_INPUTS,
  MANIFEST_TOP_LEVEL_KEYS,
} from "@/lib/elements";
import { CHIP_TONE, type ElementChipTone } from "@/lib/element-tones";

const INPUT_META: Record<string, { readonly icon: LucideIcon; readonly tone: ElementChipTone }> = {
  triggers: { icon: Workflow, tone: "sky" },
  contracts: { icon: Braces, tone: "cyan" },
  effects: { icon: Terminal, tone: "amber" },
  permissions: { icon: ShieldCheck, tone: "emerald" },
};

const SURFACE_META: Record<string, { readonly icon: LucideIcon; readonly tone: ElementChipTone }> =
  {
    "typed client (+ live queries)": { icon: Braces, tone: "cyan" },
    "OpenAPI + AsyncAPI + docs": { icon: BookOpen, tone: "sky" },
    "Console panels + traces": { icon: LayoutDashboard, tone: "teal" },
    "architecture diagram": { icon: Network, tone: "amber" },
    "MCP surface for agents": { icon: Boxes, tone: "rose" },
    "capability matrix": { icon: ShieldCheck, tone: "emerald" },
    "cache invalidation keys": { icon: KeyRound, tone: "yellow" },
    "Dockerfile + compose": { icon: Container, tone: "orange" },
  };

/**
 * Server-safe SVG: TypeScript → Manifest → fan-out. Packets use CSS classes
 * from global.css; reduced motion freezes them.
 */
function ManifestWiring(): ReactNode {
  return (
    <div className="relative hidden overflow-hidden rounded-xl border border-fd-border bg-fd-card lg:block">
      <span
        aria-hidden
        className="sently-beam-x pointer-events-none absolute top-0 z-[1] h-px w-16 bg-linear-to-r from-transparent via-fd-foreground/50 to-transparent"
      />
      <svg
        viewBox="0 0 960 220"
        role="presentation"
        aria-hidden
        className="h-auto w-full text-fd-muted-foreground"
      >
        {/* Spine routes */}
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          className="text-fd-muted-foreground/30"
        >
          <path d="M 170 110 C 250 110, 300 110, 380 110" />
          <path d="M 520 110 C 580 90, 640 70, 720 55" />
          <path d="M 520 110 C 580 100, 640 95, 720 95" />
          <path d="M 520 110 C 580 120, 640 125, 720 125" />
          <path d="M 520 110 C 580 140, 640 165, 720 175" />
        </g>

        {/* Packets */}
        <g fill="none" strokeWidth={1.75} strokeLinecap="round">
          <path
            d="M 170 110 C 250 110, 300 110, 380 110"
            pathLength={1}
            stroke="var(--oke-el-flow)"
            strokeDasharray="0.055 0.945"
            className="sently-packet-flow"
            style={{ animationDuration: "2.8s", animationDelay: "-0.6s" }}
          />
          <path
            d="M 520 110 C 580 90, 640 70, 720 55"
            pathLength={1}
            stroke="var(--oke-el-channel)"
            strokeDasharray="0.05 0.95"
            className="sently-packet-flow"
            style={{ animationDuration: "3.2s", animationDelay: "-1.1s" }}
          />
          <path
            d="M 520 110 C 580 100, 640 95, 720 95"
            pathLength={1}
            stroke="var(--oke-el-gate)"
            strokeDasharray="0.05 0.95"
            className="sently-packet-flow"
            style={{ animationDuration: "3s", animationDelay: "-0.3s" }}
          />
          <path
            d="M 520 110 C 580 120, 640 125, 720 125"
            pathLength={1}
            stroke="var(--oke-el-signal)"
            strokeDasharray="0.05 0.95"
            className="sently-packet-flow"
            style={{ animationDuration: "3.4s", animationDelay: "-1.8s" }}
          />
          <path
            d="M 520 110 C 580 140, 640 165, 720 175"
            pathLength={1}
            stroke="var(--oke-el-ai)"
            strokeDasharray="0.05 0.95"
            className="sently-packet-flow"
            style={{ animationDuration: "3.1s", animationDelay: "-0.9s" }}
          />
        </g>

        {/* Landing pins */}
        <circle
          cx={380}
          cy={110}
          r={2.5}
          fill="var(--oke-el-flow)"
          opacity={0.35}
          className="sently-node-pulse"
          style={{ animationDelay: "0.4s" }}
        />
        <circle
          cx={720}
          cy={55}
          r={2}
          fill="var(--oke-el-channel)"
          opacity={0.35}
          className="sently-node-pulse"
          style={{ animationDelay: "0.2s" }}
        />
        <circle
          cx={720}
          cy={95}
          r={2}
          fill="var(--oke-el-gate)"
          opacity={0.35}
          className="sently-node-pulse"
          style={{ animationDelay: "0.7s" }}
        />
        <circle
          cx={720}
          cy={125}
          r={2}
          fill="var(--oke-el-signal)"
          opacity={0.35}
          className="sently-node-pulse"
          style={{ animationDelay: "1.1s" }}
        />
        <circle
          cx={720}
          cy={175}
          r={2}
          fill="var(--oke-el-ai)"
          opacity={0.35}
          className="sently-node-pulse"
          style={{ animationDelay: "1.5s" }}
        />

        {/* Stage 01 — write */}
        <g className="text-fd-foreground">
          <rect x={24} y={48} width={146} height={124} rx={10} fill="none" stroke="currentColor" />
          <text
            x={97}
            y={72}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            className="font-mono"
            opacity={0.55}
          >
            01 · write
          </text>
          <text
            x={97}
            y={98}
            textAnchor="middle"
            fontSize={12}
            fill="currentColor"
            className="font-mono"
          >
            TypeScript
          </text>
          <text
            x={97}
            y={118}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            className="font-mono"
            opacity={0.55}
          >
            on · flow · fx
          </text>
          <text
            x={97}
            y={142}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            className="font-mono"
            opacity={0.45}
          >
            src/flows/**
          </text>
        </g>

        {/* Stage 02 — artifact */}
        <g className="text-fd-foreground">
          <rect
            x={380}
            y={72}
            width={140}
            height={76}
            rx={10}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
          />
          <text
            x={450}
            y={96}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            className="font-mono"
            opacity={0.55}
          >
            02 · extract
          </text>
          <text
            x={450}
            y={118}
            textAnchor="middle"
            fontSize={12}
            fill="currentColor"
            className="font-mono"
          >
            manifest.oke.json
          </text>
          <text
            x={450}
            y={136}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            className="font-mono"
            opacity={0.45}
          >
            one artifact
          </text>
        </g>

        {/* Stage 03 — surfaces */}
        <g className="text-fd-foreground">
          {[
            { y: 42, label: "typed client" },
            { y: 82, label: "Console · MCP" },
            { y: 122, label: "OpenAPI · docs" },
            { y: 162, label: "Dockerfile · caps" },
          ].map((row) => (
            <g key={row.label}>
              <rect
                x={730}
                y={row.y}
                width={200}
                height={28}
                rx={6}
                fill="none"
                stroke="currentColor"
                opacity={0.7}
              />
              <text
                x={830}
                y={row.y + 18}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                className="font-mono"
              >
                {row.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <p className="sr-only">
        Diagram: TypeScript flows are parsed into manifest.oke.json; client, Console, MCP, docs, and
        runtime artifacts are derived from that one file.
      </p>
    </div>
  );
}

/** Mobile / narrow: stage cards without the SVG. */
function ManifestStages(): ReactNode {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border lg:hidden">
      <section className="bg-fd-card px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-fd-muted-foreground">01</span>
            <h3 className="text-sm font-medium">You write TypeScript</h3>
          </span>
          <code className="font-mono text-[10px] text-fd-muted-foreground">src/flows/**</code>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {MANIFEST_INPUTS.map((input) => {
            const meta = INPUT_META[input.records] ?? { icon: Terminal, tone: "sky" as const };
            const Icon = meta.icon;
            const tone = CHIP_TONE[meta.tone];
            return (
              <li
                key={input.syntax}
                className="flex items-start gap-2.5 rounded-lg border border-fd-border bg-fd-secondary/30 px-3 py-2"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border",
                    tone.idle,
                  )}
                >
                  <Icon aria-hidden className={cn("size-3", tone.icon)} strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <code className="block font-mono text-[11px] text-fd-foreground">
                    {input.syntax}
                  </code>
                  <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
                    {input.records}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="bg-fd-secondary/40 px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-fd-muted-foreground">02</span>
            <h3 className="text-sm font-medium">One artifact</h3>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-card px-2 py-0.5 font-mono text-[10px] text-fd-foreground">
            <FileJson2
              aria-hidden
              className="size-3 text-teal-600 dark:text-teal-400"
              strokeWidth={1.75}
            />
            manifest.oke.json
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          <KeyChips label="top level" keys={MANIFEST_TOP_LEVEL_KEYS} tone="teal" />
          <KeyChips label="per flow" keys={MANIFEST_FLOW_KEYS} tone="sky" />
        </div>
      </section>

      <section className="bg-fd-card px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-fd-muted-foreground">03</span>
            <h3 className="text-sm font-medium">Every surface is derived</h3>
          </span>
          <span className="rounded-full border border-fd-border px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
            {DERIVED_SURFACES.length} surfaces
          </span>
        </div>
        <SurfaceGrid />
      </section>
    </div>
  );
}

function KeyChips({
  label,
  keys,
  tone,
}: {
  readonly label: string;
  readonly keys: ReadonlyArray<string>;
  readonly tone: ElementChipTone;
}): ReactNode {
  const chip = CHIP_TONE[tone];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
        {label}
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {keys.map((key) => (
          <li
            key={key}
            className={cn("rounded border px-1.5 py-0.5 font-mono text-[11px]", chip.idle)}
          >
            {key}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SurfaceGrid(): ReactNode {
  return (
    <ul className="grid grid-cols-1 gap-2 @min-[28rem]:grid-cols-2">
      {DERIVED_SURFACE_GROUPS.flatMap((group) =>
        group.surfaces.map((surface) => {
          const meta = SURFACE_META[surface] ?? { icon: Boxes, tone: "sky" as const };
          const Icon = meta.icon;
          const tone = CHIP_TONE[meta.tone];
          return (
            <li
              key={surface}
              className="flex items-start gap-2.5 rounded-lg border border-fd-border bg-fd-secondary/20 px-3 py-2"
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border",
                  tone.idle,
                )}
              >
                <Icon aria-hidden className={cn("size-3", tone.icon)} strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] leading-snug text-fd-foreground">{surface}</span>
                <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
                  {group.label}
                </span>
              </span>
            </li>
          );
        }),
      )}
    </ul>
  );
}

/** Detail panel under the wiring diagram (desktop). */
function ManifestDetail(): ReactNode {
  return (
    <div className="hidden gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border lg:grid lg:grid-cols-3">
      <div className="bg-fd-card px-4 py-4">
        <p className="mb-2.5 font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
          01 · inputs via fx
        </p>
        <ul className="flex flex-col gap-2">
          {MANIFEST_INPUTS.map((input) => {
            const meta = INPUT_META[input.records] ?? { icon: Terminal, tone: "sky" as const };
            const Icon = meta.icon;
            const tone = CHIP_TONE[meta.tone];
            return (
              <li key={input.syntax} className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded border",
                    tone.idle,
                  )}
                >
                  <Icon aria-hidden className={cn("size-2.5", tone.icon)} strokeWidth={1.75} />
                </span>
                <code className="truncate font-mono text-[11px] text-fd-foreground">
                  {input.syntax}
                </code>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="bg-fd-card px-4 py-4">
        <p className="mb-2.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
          <FileJson2
            aria-hidden
            className="size-3 text-teal-600 dark:text-teal-400"
            strokeWidth={1.75}
          />
          02 · artifact keys
        </p>
        <KeyChips label="top level" keys={MANIFEST_TOP_LEVEL_KEYS} tone="teal" />
        <div className="mt-3">
          <KeyChips label="per flow" keys={MANIFEST_FLOW_KEYS.slice(0, 5)} tone="sky" />
        </div>
      </div>
      <div className="bg-fd-card px-4 py-4">
        <p className="mb-2.5 font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
          03 · derived · {DERIVED_SURFACES.length}
        </p>
        <SurfaceGrid />
      </div>
    </div>
  );
}

/**
 * Code → `manifest.oke.json` → derived surfaces.
 */
export function ManifestPipeline(): ReactNode {
  return (
    <figure
      className="@container not-prose m-0 flex w-full max-w-full min-w-0 flex-col gap-4"
      aria-label="Manifest pipeline in three stages: you write TypeScript flows whose world access goes through fx; at build time the compiler extracts manifest.oke.json; and every downstream surface is derived from that one artifact."
    >
      <ManifestWiring />
      <ManifestDetail />
      <ManifestStages />
    </figure>
  );
}
