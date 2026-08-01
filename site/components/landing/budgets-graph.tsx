/**
 * Budgets panel — AGENTS caps as headline metrics, then public export sizes
 * compared to each other. Numbers come from `budgets.json` (CI-enforced).
 */

"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  BUDGETS_MEASURED_AT,
  BUDGETS_VERSION,
  OFFICIAL_PLUGIN_BUDGETS,
  PLUGIN_BUDGET_CATEGORIES,
  budgetById,
  budgetUsedPercent,
  formatBytesLanding,
  formatLimitLanding,
  formatValueLanding,
  type PluginBudgetCategory,
} from "@/lib/budgets";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

type CoreMetric = {
  readonly id: string;
  readonly name: string;
  readonly meaning: string;
  readonly value: string;
  readonly limit: string;
  readonly used: number;
  readonly ok: boolean;
};

type ExportMetric = {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly display: string;
  readonly ok: boolean;
};

type PluginMetric = ExportMetric & {
  readonly category: PluginBudgetCategory;
};

const CORE_SPEC = [
  {
    id: "kernelEdgeGzipBytes",
    name: "Kernel",
    meaning: "edge profile · gzip",
  },
  {
    id: "clientGzipBytes",
    name: "Client",
    meaning: "browser runtime · gzip",
  },
  {
    id: "coldStartMedianMs",
    name: "Cold start",
    meaning: "median boot on Bun",
  },
  {
    id: "routingP99Ms",
    name: "Routing",
    meaning: "p99 overhead per request",
  },
] as const;

/**
 * Leaf entrypoints — bars scaled to the root `okengine` barrel (100%).
 * `okengine/plugins` lives in its own table below (named-export barrel).
 */
const EXPORT_IDS = [
  "export:./signal",
  "export:./store",
  "export:./clock",
  "export:./gate",
  "export:./vault",
  "export:./channel",
  "export:./ai",
  "export:./client",
  "export:./auth",
] as const;

function coreMetric(spec: (typeof CORE_SPEC)[number]): CoreMetric {
  const row = budgetById(spec.id);
  return {
    id: row.id,
    name: spec.name,
    meaning: spec.meaning,
    value: formatValueLanding(row),
    limit: formatLimitLanding(row),
    used: budgetUsedPercent(row),
    ok: row.ok,
  };
}

function exportMetric(id: (typeof EXPORT_IDS)[number] | "export:."): ExportMetric {
  const row = budgetById(id);
  return {
    id: row.id,
    name: row.label === "okengine" ? "okengine" : `okengine/${row.label}`,
    bytes: row.value,
    display: formatBytesLanding(row.value),
    ok: row.ok,
  };
}

function pluginMetric(name: string, category: PluginBudgetCategory): PluginMetric {
  const row = budgetById(`export:./plugins/${name}`);
  return {
    id: row.id,
    name: row.label,
    bytes: row.value,
    display: formatBytesLanding(row.value),
    ok: row.ok,
    category,
  };
}

const CORE = CORE_SPEC.map(coreMetric);
const BASELINE = exportMetric("export:.");
const PLUGINS = (() => {
  const row = budgetById("export:./plugins");
  return {
    id: row.id,
    name: "okengine/plugins",
    bytes: row.value,
    display: formatBytesLanding(row.value),
    ok: row.ok,
  };
})();
/** Smallest first — share of the root barrel, not package.json order. */
const EXPORT_ROWS = EXPORT_IDS.map(exportMetric).sort((a, b) => a.bytes - b.bytes);
const BASELINE_BYTES = Math.max(BASELINE.bytes, 1);
const PLUGIN_ROWS = OFFICIAL_PLUGIN_BUDGETS.map((p) => pluginMetric(p.name, p.category));
const PLUGIN_BAR_BASE = CORE.length + 1 + EXPORT_ROWS.length;

/**
 * Category blocks in docs order; rows smallest-first.
 * Share is vs `okengine` (same scale as the barrel row) — standalone samples
 * share deps, so they must not be presented as fractions of the barrel total.
 */
const PLUGIN_GROUPS = PLUGIN_BUDGET_CATEGORIES.map((category) => {
  const rows = PLUGIN_ROWS.filter((row) => row.category === category)
    .sort((a, b) => a.bytes - b.bytes)
    .map((row) => ({
      ...row,
      share: (row.bytes / BASELINE_BYTES) * 100,
    }));
  return { category, rows };
}).filter((g) => g.rows.length > 0);

/** Stable animation index per plugin id (category order, then size order). */
const PLUGIN_BAR_INDEX = new Map<string, number>(
  PLUGIN_GROUPS.flatMap((g) => g.rows).map((row, i) => [row.id, PLUGIN_BAR_BASE + 1 + i]),
);

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 32, mass: 0.75 },
  },
};

/**
 * Fill bar — self-animates on mount so collapsible panels (closed at load)
 * still get a visible fill when opened.
 */
function FillBar({
  widthPercent,
  index,
  className,
  trackClassName,
}: {
  readonly widthPercent: number;
  readonly index: number;
  readonly className?: string;
  readonly trackClassName?: string;
}): ReactNode {
  const width = Math.min(100, Math.max(widthPercent > 0 ? 4 : 0, widthPercent));
  return (
    <span
      className={cn(
        "relative mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-fd-border",
        trackClassName,
      )}
    >
      <motion.span
        className={cn("block h-full origin-left rounded-full", className)}
        style={{ width: `${width}%` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{
          duration: 0.55,
          ease: [0.16, 1, 0.3, 1],
          delay: 0.06 + index * 0.03,
        }}
      />
    </span>
  );
}

/**
 * Usage bar against the hard cap (core metrics).
 */
function CapBar({
  used,
  index,
  ok,
}: {
  readonly used: number;
  readonly index: number;
  readonly ok: boolean;
}): ReactNode {
  return (
    <FillBar
      widthPercent={used}
      index={index}
      trackClassName="mt-3"
      className={ok ? "bg-fd-foreground/75" : "bg-fd-muted-foreground/50"}
    />
  );
}

/**
 * Size bar vs the root `okengine` baseline (100%).
 */
function RelativeBar({
  share,
  index,
  emphasis,
}: {
  readonly share: number;
  readonly index: number;
  readonly emphasis?: boolean;
}): ReactNode {
  return (
    <FillBar
      widthPercent={share}
      index={index}
      className={emphasis ? "bg-fd-foreground/85" : "bg-fd-foreground/55"}
    />
  );
}

/**
 * Headline AGENTS caps — big measured number, clear ceiling, short meaning.
 */
function CoreGrid(): ReactNode {
  return (
    <motion.ul
      variants={item}
      className="grid gap-px bg-fd-border @min-[32rem]:grid-cols-2 @min-[56rem]:grid-cols-4"
    >
      {CORE.map((metric, index) => (
        <motion.li
          key={metric.id}
          variants={item}
          className="flex min-w-0 flex-col bg-fd-card px-4 py-4 sm:px-5 sm:py-5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
              {metric.name}
            </span>
            <span
              className={cn(
                "mt-1 size-1.5 shrink-0 rounded-full",
                metric.ok ? "bg-[var(--oke-el-gate)]" : "bg-fd-muted-foreground/50",
              )}
              title={metric.ok ? "within budget" : "over budget"}
            />
          </div>
          <p className="mt-2 font-mono text-[1.65rem] leading-none tracking-tight text-fd-foreground tabular-nums sm:text-[1.85rem]">
            {metric.value}
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-fd-muted-foreground tabular-nums">
            of {metric.limit}
            <span className="mx-1.5 text-fd-muted-foreground/40">·</span>
            {Math.round(metric.used)}% used
          </p>
          <p className="mt-1 text-xs text-fd-muted-foreground">{metric.meaning}</p>
          <CapBar used={metric.used} index={index} ok={metric.ok} />
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * Toggle row for collapsing entrypoint / plugin sub-lists (closed by default).
 */
function CollapseTrigger({
  label,
  count,
}: {
  readonly label: string;
  readonly count: number;
}): ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full items-center gap-3 px-4 py-1.5 text-left sm:px-5",
        "font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase",
        "outline-none transition-colors hover:text-fd-foreground",
        "focus-visible:bg-fd-secondary/40",
      )}
    >
      <span className="h-px flex-1 bg-fd-border" />
      <span className="flex items-center gap-1.5">
        {label}
        <span className="tabular-nums text-fd-muted-foreground/70">({count})</span>
        <ChevronDown
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-200 group-data-[panel-open]:rotate-180"
          strokeWidth={1.75}
        />
      </span>
      <span className="h-px flex-1 bg-fd-border" />
    </CollapsibleTrigger>
  );
}

/**
 * Root `okengine` baseline only; leaf entrypoints collapsed by default.
 */
function ExportList(): ReactNode {
  return (
    <motion.div variants={item} className="bg-fd-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-fd-foreground uppercase">
          import all · or pick
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
          gzip · vs okengine
        </span>
      </div>

      <Collapsible defaultOpen>
        <motion.div variants={item} className="bg-fd-secondary/40 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className="min-w-0">
              <span className="font-mono text-sm text-fd-foreground">{BASELINE.name}</span>
              <span className="ml-2 font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
                baseline · full import
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-2 font-mono text-sm tabular-nums">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  BASELINE.ok ? "bg-[var(--oke-el-gate)]" : "bg-fd-muted-foreground/50",
                )}
                title={BASELINE.ok ? "within budget" : "over budget"}
              />
              <span className="text-fd-foreground">{BASELINE.display}</span>
            </span>
          </div>
          <RelativeBar share={100} index={CORE.length} emphasis />
        </motion.div>

        <CollapseTrigger label="or pick" count={EXPORT_ROWS.length} />

        <CollapsibleContent>
          <ul className="divide-y divide-fd-border border-t border-fd-border">
            {EXPORT_ROWS.map((row, index) => {
              const share = (row.bytes / BASELINE_BYTES) * 100;
              return (
                <li key={row.id} className="px-4 py-2 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 truncate font-mono text-xs text-fd-foreground">
                      {row.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          row.ok ? "bg-[var(--oke-el-gate)]" : "bg-fd-muted-foreground/50",
                        )}
                        title={row.ok ? "within budget" : "over budget"}
                      />
                      <span className="text-fd-foreground">{row.display}</span>
                      <span className="text-fd-muted-foreground">{Math.round(share)}%</span>
                    </span>
                  </div>
                  <RelativeBar share={share} index={CORE.length + 1 + index} />
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}

/**
 * Plugins barrel — bar scaled to the `okengine` baseline (same scale as or-pick).
 * Per-plugin rows still use % of the plugins barrel.
 */
function PluginsTable(): ReactNode {
  const pluginCount = PLUGIN_ROWS.length;
  const barrelShareOfOkengine = (PLUGINS.bytes / BASELINE_BYTES) * 100;

  return (
    <motion.div variants={item} className="bg-fd-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-fd-foreground uppercase">
          okengine/plugins
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
          gzip · vs okengine
        </span>
      </div>

      <Collapsible defaultOpen={false}>
        <motion.div variants={item} className="bg-fd-secondary/40 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className="min-w-0">
              <span className="font-mono text-sm text-fd-foreground">{PLUGINS.name}</span>
              <span className="ml-2 font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
                barrel · vs okengine
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-2 font-mono text-sm tabular-nums">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  PLUGINS.ok ? "bg-[var(--oke-el-gate)]" : "bg-fd-muted-foreground/50",
                )}
                title={PLUGINS.ok ? "within budget" : "over budget"}
              />
              <span className="text-fd-foreground">{PLUGINS.display}</span>
              <span className="text-fd-muted-foreground">{Math.round(barrelShareOfOkengine)}%</span>
            </span>
          </div>
          <RelativeBar share={barrelShareOfOkengine} index={PLUGIN_BAR_BASE} emphasis />
        </motion.div>

        <CollapseTrigger label="by category" count={pluginCount} />

        <CollapsibleContent>
          <p className="border-t border-fd-border px-4 py-1.5 font-mono text-[10px] tracking-[0.08em] text-fd-muted-foreground/80 uppercase sm:px-5">
            standalone samples · shared deps overlap · % vs okengine
          </p>
          {PLUGIN_GROUPS.map(({ category, rows }) => (
            <div key={category}>
              <div className="border-t border-fd-border px-4 py-1.5 sm:px-5">
                <span className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
                  {category}
                </span>
              </div>
              <ul className="divide-y divide-fd-border border-t border-fd-border">
                {rows.map((row) => (
                  <li key={row.id} className="px-4 py-2 sm:px-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="min-w-0 truncate font-mono text-xs text-fd-foreground">
                        {row.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            row.ok ? "bg-[var(--oke-el-gate)]" : "bg-fd-muted-foreground/50",
                          )}
                          title={row.ok ? "within budget" : "over budget"}
                        />
                        <span className="text-fd-foreground">{row.display}</span>
                        <span className="text-fd-muted-foreground">{Math.round(row.share)}%</span>
                      </span>
                    </div>
                    <RelativeBar share={row.share} index={PLUGIN_BAR_INDEX.get(row.id) ?? 0} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}

/**
 * Measured budgets — same panel language as Surfaces / CodePanel / Vocabulary.
 */
export function BudgetsGraph(): ReactNode {
  const reduced = useClientReducedMotion();
  const measuredDay = BUDGETS_MEASURED_AT.slice(0, 10);

  return (
    <MotionConfig reducedMotion="never">
      <motion.div
        className="@container not-prose w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
        variants={list}
        initial={reduced ? false : "hidden"}
        whileInView={reduced ? undefined : "show"}
        viewport={{ once: true, margin: "-8% 0px" }}
      >
        <motion.div
          variants={item}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-fd-border px-4 py-3 sm:px-5"
        >
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
            <span
              aria-hidden
              className="sently-dot-pulse size-1 rounded-full bg-fd-foreground/60"
            />
            CI budgets
          </span>
          <span className="font-mono text-[11px] tracking-[0.08em] text-fd-muted-foreground">
            hard caps · measured from <code className="text-fd-foreground/80">budgets.json</code>
          </span>
        </motion.div>

        <div className="flex flex-col gap-px bg-fd-border">
          <CoreGrid />
          <ExportList />
          <PluginsTable />
        </div>

        <motion.p
          variants={item}
          className="border-t border-fd-border px-4 py-2.5 font-mono text-[10px] tracking-[0.08em] text-fd-muted-foreground/80 uppercase sm:px-5"
        >
          okengine v{BUDGETS_VERSION} · measured {measuredDay} · gzip · export peers excluded
        </motion.p>
      </motion.div>
    </MotionConfig>
  );
}
