/**
 * Manifest pipeline — original okengine visual (unified-theory §8).
 *
 * Three stages, top to bottom: what you write, what the compiler extracts, and
 * what is derived from that one artifact. Built from flex/grid rather than a
 * hand-positioned SVG so the labels stay at real font sizes and the stages
 * stack on a phone instead of scrolling sideways.
 */

import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  DERIVED_SURFACE_GROUPS,
  DERIVED_SURFACES,
  MANIFEST_FLOW_KEYS,
  MANIFEST_INPUTS,
  MANIFEST_TOP_LEVEL_KEYS,
} from "@/lib/elements";

/**
 * Stage header strip: index, title, and the artifact the stage deals in.
 *
 * @param index - Two-digit stage number
 * @param title - Stage title
 * @param meta - Right-aligned monospace artifact label
 */
function StageHeader({ index, title, meta }: { index: string; title: string; meta: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-6">
      <h3 className="flex items-baseline gap-3 text-sm font-medium text-fd-foreground">
        <span className="font-mono text-[10px] text-fd-muted-foreground/70">{index}</span>
        {title}
      </h3>
      <code className="font-mono text-[11px] text-fd-muted-foreground">{meta}</code>
    </div>
  );
}

/**
 * Direction marker between two stages.
 *
 * @param caption - What happens across this step
 */
function StageArrow({ caption }: { caption: string }) {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-fd-border px-4 py-2">
      <ArrowDown className="size-3 shrink-0 text-fd-muted-foreground/70" aria-hidden />
      <span className="font-mono text-[10px] tracking-[0.16em] text-fd-muted-foreground uppercase">
        {caption}
      </span>
    </div>
  );
}

/**
 * A labelled row of monospace key chips.
 *
 * @param label - Row label
 * @param keys - Key names to list
 */
function KeyRow({ label, keys }: { label: string; keys: ReadonlyArray<string> }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="w-20 shrink-0 font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
        {label}
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {keys.map((key) => (
          <li
            key={key}
            className="rounded border border-fd-border bg-fd-card px-1.5 py-0.5 font-mono text-[11px] text-fd-foreground"
          >
            {key}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Muted note line used under a stage body. */
function StageNote({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-fd-muted-foreground">{children}</p>;
}

/**
 * Code → `manifest.oke.json` → derived surfaces, as three stacked stages.
 */
export function ManifestPipeline() {
  return (
    <figure
      className="@container not-prose m-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Manifest pipeline in three stages: you write TypeScript flows whose world access goes through fx; at build time the compiler extracts manifest.oke.json, recording flows, triggers, contracts, effects, gates, signals and drivers; and every downstream surface — typed client, OpenAPI and docs, Console panels and traces, architecture diagram, MCP surface, capability matrix, cache invalidation keys, Dockerfile and compose — is derived from that one artifact."
    >
      <StageHeader index="01" title="You write TypeScript" meta="src/flows/**" />
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6">
        <ul className="grid gap-2 sm:grid-cols-2">
          {MANIFEST_INPUTS.map((input) => (
            <li
              key={input.syntax}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-fd-border bg-fd-secondary/30 px-3 py-2"
            >
              <code className="font-mono text-[11px] text-fd-foreground">{input.syntax}</code>
              <span className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
                {input.records}
              </span>
            </li>
          ))}
        </ul>
        <StageNote>
          Nothing to annotate by hand: <code className="text-fd-foreground">fx</code> is the only
          door to the world, so the compiler can see every read, write, emit, and secret.
        </StageNote>
      </div>

      <StageArrow caption="oke build · oxc parse" />

      <div className="bg-fd-secondary/40">
        <StageHeader index="02" title="One artifact is extracted" meta="manifest.oke.json" />
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6">
          <KeyRow label="top level" keys={MANIFEST_TOP_LEVEL_KEYS} />
          <KeyRow label="per flow" keys={MANIFEST_FLOW_KEYS} />
          <StageNote>
            A machine-readable description of the whole system, versioned independently of the
            runtime (<code className="text-fd-foreground">&quot;oke&quot;: &quot;1.0&quot;</code>).
          </StageNote>
        </div>
      </div>

      <StageArrow caption="derived, not configured" />

      <StageHeader
        index="03"
        title="Every surface is derived"
        meta={`${DERIVED_SURFACES.length} surfaces`}
      />
      <ul className="grid grid-cols-1 gap-px bg-fd-border @min-[32rem]:grid-cols-3">
        {DERIVED_SURFACE_GROUPS.map((group) => (
          <li key={group.label} className="min-w-0 bg-fd-card px-4 py-4 sm:px-6">
            <p className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
              {group.label}
            </p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {group.surfaces.map((surface) => (
                <li key={surface} className="flex min-w-0 gap-2 text-sm text-fd-foreground">
                  <span aria-hidden className="shrink-0 text-fd-muted-foreground/50 select-none">
                    ↳
                  </span>
                  <span className="min-w-0 break-words">{surface}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </figure>
  );
}
