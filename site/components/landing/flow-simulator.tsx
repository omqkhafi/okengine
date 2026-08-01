/**
 * Flow simulator — the one-law claim as a living diagram. Auto-plays rotating
 * triggers (HTTP → cron → signal → CDC): a packet walks trigger → on() → Flow
 * → Effects. Same path every time; only the trigger changes. Pauses offscreen
 * and under reduced motion (final frame). Desktop-only; the static trigger
 * list stays for small screens.
 */

"use client";

import { AnimatePresence, MotionConfig, motion, useInView } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

type TriggerKind = "http" | "cron" | "signal" | "cdc";

type SimState = {
  readonly active: number;
  readonly log: string;
  readonly trigger: TriggerKind;
  readonly result: "pending" | "ok";
};

type TimelineEntry = {
  readonly at: number;
  readonly patch: Partial<SimState>;
};

const TRIGGERS: ReadonlyArray<{
  readonly kind: TriggerKind;
  readonly code: string;
  readonly zoo: string;
}> = [
  { kind: "http", code: 'http.post("/bookings")', zoo: "an API endpoint" },
  { kind: "cron", code: 'every("10m")', zoo: "a cron job" },
  { kind: "signal", code: "orderPlaced", zoo: "a queue consumer" },
  { kind: "cdc", code: 'db.table(users).changed("email")', zoo: "a CDC trigger" },
];

const RUN_MS = 4200;

const NODES = [
  { step: "01", title: "Trigger", detail: "typed value" },
  { step: "02", title: "on()", detail: "bind" },
  { step: "03", title: "Flow", detail: "one species" },
  { step: "04", title: "Effects", detail: "via fx" },
] as const;

function timeline(kind: TriggerKind): ReadonlyArray<TimelineEntry> {
  const row = TRIGGERS.find((t) => t.kind === kind)!;
  return [
    {
      at: 0,
      patch: {
        active: 0,
        trigger: kind,
        result: "pending",
        log: `on(${row.code})`,
      },
    },
    {
      at: 700,
      patch: {
        active: 1,
        log: `bind · was ${row.zoo}`,
      },
    },
    {
      at: 1450,
      patch: {
        active: 2,
        log: "Flow · same species",
      },
    },
    {
      at: 2200,
      patch: {
        active: 3,
        result: "ok",
        log: "Effects · inferred through fx",
      },
    },
  ];
}

const IDLE: SimState = {
  active: -1,
  log: 'on(http.post("/bookings"))',
  trigger: "http",
  result: "pending",
};

const DONE: SimState = {
  active: 3,
  log: "Effects · inferred through fx",
  trigger: "http",
  result: "ok",
};

/**
 * One run of the Flow path; timers drive the timeline down the four stages.
 */
export function FlowSimulator(): ReactNode {
  const reduced = useClientReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { margin: "-12% 0px" });
  const [run, setRun] = useState(0);
  const [state, setState] = useState<SimState>(reduced ? DONE : IDLE);

  useEffect(() => {
    if (reduced || !inView) return;
    let cancelled = false;
    const ids: Array<number> = [];
    const kind = TRIGGERS[run % TRIGGERS.length]!.kind;
    for (const entry of timeline(kind)) {
      ids.push(
        window.setTimeout(() => {
          if (!cancelled) setState((prev) => ({ ...prev, ...entry.patch }));
        }, entry.at),
      );
    }
    ids.push(
      window.setTimeout(() => {
        if (!cancelled) setRun((r) => r + 1);
      }, RUN_MS),
    );
    return () => {
      cancelled = true;
      for (const id of ids) window.clearTimeout(id);
    };
  }, [run, inView, reduced]);

  const sim = reduced ? DONE : state;
  const activeTrigger = TRIGGERS.find((t) => t.kind === sim.trigger) ?? TRIGGERS[0]!;

  return (
    <MotionConfig reducedMotion="never">
      <figure
        ref={rootRef}
        className="not-prose m-0 flex h-full w-full flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      >
        <p className="sr-only">
          Animation demonstrates that HTTP, cron, signal, and CDC triggers are the same Flow
          species: each binds with on(), runs one Flow, and produces Effects through fx.
        </p>

        <figcaption className="flex items-center justify-between gap-3 border-b border-fd-border px-4 py-2.5">
          <span className="flex items-center gap-2 font-mono text-[11px] text-fd-muted-foreground">
            <span
              aria-hidden
              className="sently-dot-pulse size-1 rounded-full bg-fd-foreground/60"
            />
            live · one law
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={activeTrigger.zoo}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="font-mono text-[11px] text-fd-muted-foreground"
            >
              {activeTrigger.zoo}
            </motion.span>
          </AnimatePresence>
        </figcaption>

        <ol className="flex flex-1 flex-col px-4 py-5 sm:px-5">
          {NODES.map((node, index) => {
            const lit = sim.active >= index;
            const current = sim.active === index;
            const detail = index === 0 ? activeTrigger.code : node.detail;
            const last = index === NODES.length - 1;
            return (
              <li key={node.step} className={cn("relative flex gap-3", !last && "flex-1")}>
                <div className="flex w-9 shrink-0 flex-col items-center">
                  <span
                    className={cn(
                      "relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] transition-colors duration-300",
                      lit
                        ? "border-fd-foreground/50 bg-fd-foreground text-fd-background"
                        : "border-fd-border bg-fd-card text-fd-muted-foreground",
                      current && "shadow-[0_0_0_3px] shadow-fd-foreground/10",
                    )}
                  >
                    {node.step}
                  </span>
                  {!last ? (
                    <span
                      aria-hidden
                      className={cn(
                        "my-1 w-px flex-1 min-h-4 transition-colors duration-300",
                        sim.active > index ? "bg-fd-foreground/35" : "bg-fd-border",
                      )}
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col pt-1.5">
                  <span
                    className={cn(
                      "text-sm font-medium transition-colors duration-300",
                      lit ? "text-fd-foreground" : "text-fd-muted-foreground",
                    )}
                  >
                    {node.title}
                  </span>
                  {index === 0 ? (
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={detail}
                        initial={reduced ? false : { opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? undefined : { opacity: 0, y: -3 }}
                        transition={{ duration: 0.16 }}
                        className="mt-0.5 block truncate font-mono text-[11px] text-fd-muted-foreground/80"
                      >
                        {detail}
                      </motion.span>
                    </AnimatePresence>
                  ) : (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-fd-muted-foreground/80">
                      {detail}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex min-h-[2.75rem] items-center border-t border-fd-border px-4 py-2.5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={sim.log}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="font-mono text-[11px] text-fd-muted-foreground"
            >
              <span
                className={cn(
                  "mr-2 inline-block size-1.5 rounded-full",
                  sim.result === "ok" ? "bg-[var(--oke-el-gate)]" : "bg-fd-foreground/40",
                )}
              />
              {sim.log}
            </motion.span>
          </AnimatePresence>
        </div>
      </figure>
    </MotionConfig>
  );
}

/** Static trigger list — mobile / reduced-motion honest fallback. */
export function TriggerList(): ReactNode {
  return (
    <dl className="flex flex-col divide-y divide-fd-border overflow-hidden rounded-xl border border-fd-border bg-fd-card px-4">
      {TRIGGERS.map((item) => (
        <div
          key={item.code}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
        >
          <dt className="font-mono text-xs text-fd-foreground">on({item.code})</dt>
          <dd className="text-xs text-fd-muted-foreground">{item.zoo}</dd>
        </div>
      ))}
    </dl>
  );
}
