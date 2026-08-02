/**
 * Four store facets — sql / kv / files / index, one fx.store handle per facet.
 *
 * Hovering a card cascades that handle's verbs as chips (the Features grid's
 * PreviewPills micro-interaction) and wiggles the facet icon. The handle is
 * what a flow can *do* with the facet — the chips are the physics.
 */

"use client";

import { motion, type Variants } from "framer-motion";
import { Braces, Database, FolderOpen, Search, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { RevealGroup, RevealItem } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const tone = CHIP_TONE.teal;

const VERB_ROW: Variants = {
  idle: {},
  hover: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

const VERB_CHIP: Variants = {
  idle: { y: 0, scale: 1 },
  hover: { y: -2, scale: 1.05 },
};

const FACETS: ReadonlyArray<{
  readonly id: string;
  readonly icon: LucideIcon;
  readonly declare: string;
  readonly kind: string;
  readonly verbs: ReadonlyArray<string>;
  readonly forData: string;
}> = [
  {
    id: "sql",
    icon: Database,
    declare: "store.sql(name, opts)",
    kind: "Relational tables",
    verbs: ["select", "insert", "update", "delete", "findById"],
    forData: "Domain tables, relations, constraints",
  },
  {
    id: "kv",
    icon: Braces,
    declare: "store.kv(name)",
    kind: "Key-value space",
    verbs: ["get", "set · ttl", "delete", "list"],
    forData: "Cache, sessions, rate limits",
  },
  {
    id: "files",
    icon: FolderOpen,
    declare: "store.files(name)",
    kind: "Blob bucket",
    verbs: ["put", "get", "delete", "list", "image", "putImage"],
    forData: "Uploads, exports, attachments, image variants",
  },
  {
    id: "index",
    icon: Search,
    declare: "store.index(name, opts)",
    kind: "Search index",
    verbs: ["upsert", "search", "delete"],
    forData: "Vector (dims) or full-text",
  },
];

/**
 * One declaration style, four storage physics — drivers swap per environment.
 */
export function StoreFacets() {
  const reduced = useClientReducedMotion();
  const [active, setActive] = useState<string | null>(null);

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Four store facets — SQL tables, key-value cache, file blobs, and search index — behind one fx.store handle, drivers swapped per environment."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Four facets, one handle</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.store(db)…
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        {FACETS.map((f) => {
          const Icon = f.icon;
          const hovered = active === f.id;
          return (
            <RevealItem
              as="li"
              lift
              key={f.id}
              className="flex min-w-0 flex-col gap-1.5 bg-fd-card px-4 py-4 transition-colors hover:bg-fd-secondary/40 sm:px-5"
            >
              <div
                onPointerEnter={() => setActive(f.id)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(f.id)}
                onBlur={() => setActive(null)}
                className="flex min-w-0 flex-col gap-1.5"
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <code className="inline-flex items-center gap-1.5 font-mono text-sm font-medium text-fd-foreground">
                    <motion.span
                      aria-hidden
                      animate={
                        hovered && !reduced ? { scale: 1.12, rotate: -6 } : { scale: 1, rotate: 0 }
                      }
                      transition={{ type: "spring", stiffness: 520, damping: 28, mass: 0.55 }}
                      className={cn(
                        "inline-flex transition-colors",
                        hovered ? tone.icon : "text-fd-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </motion.span>
                    {f.id}
                  </code>
                  <span className="text-[11px] text-fd-muted-foreground">{f.kind}</span>
                </div>
                <code className="max-w-full font-mono text-[11px] break-all text-fd-muted-foreground">
                  {f.declare}
                </code>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-fd-muted-foreground/70">fx.store(…):</span>
                  <motion.span
                    className="flex flex-wrap gap-1"
                    variants={VERB_ROW}
                    initial="idle"
                    animate={reduced || !hovered ? "idle" : "hover"}
                  >
                    {f.verbs.map((verb) => (
                      <motion.code
                        key={verb}
                        variants={VERB_CHIP}
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                          hovered ? tone.active : "border-fd-border text-fd-muted-foreground",
                        )}
                      >
                        {verb}
                      </motion.code>
                    ))}
                  </motion.span>
                </div>
                <p className="mt-auto pt-0.5 text-[11px] text-pretty text-fd-muted-foreground">
                  {f.forData}
                </p>
              </div>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}
