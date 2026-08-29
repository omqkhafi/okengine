/**
 * Six systems drift — visual teaching figure for the Start onboarding narrative.
 *
 * Demonstrates the 8-month sprawl: how a 4-line signup route explodes into 6 decoupled
 * files across separate boundaries as production requirements accumulate.
 */

"use client";

import { motion } from "framer-motion";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { cn } from "@/lib/cn";

interface TimelineStep {
  readonly time: string;
  readonly trigger: string;
  readonly consequence: string;
  readonly activeFileIndices: readonly number[];
}

interface SystemFile {
  readonly path: string;
  readonly role: string;
  readonly risk: string;
}

const FILES: readonly SystemFile[] = [
  {
    path: "routes/signup.ts",
    role: "HTTP handler & user creation",
    risk: "Enqueues blindly; assumes queue contract",
  },
  {
    path: "queues/email.ts",
    role: "BullMQ / In-memory queue spec",
    risk: "Missing retry & dead-letter physics",
  },
  {
    path: "workers/sendWelcome.ts",
    role: "Execution worker & audit writer",
    risk: "Double duty: send mail + audit write",
  },
  {
    path: "lib/redis.ts",
    role: "Shared Redis connection",
    risk: "Undeclared staging deploy dependency",
  },
  {
    path: "lib/mailer.ts",
    role: "External provider API client",
    risk: "Uncaught 429 rate limits & slow network",
  },
  {
    path: "db/sentEmails.ts",
    role: "Compliance audit table",
    risk: "Secondary uncoordinated DB write failure",
  },
];

const TIMELINE_STEPS: readonly TimelineStep[] = [
  {
    time: "Day 1",
    trigger: "First user signup",
    consequence: "1 simple 4-line route with inline email send",
    activeFileIndices: [0],
  },
  {
    time: "Week 2",
    trigger: "Marketing spike & 429 errors",
    consequence: "Queue, worker, and Redis connection extracted to background",
    activeFileIndices: [0, 1, 2, 3],
  },
  {
    time: "Month 2–6",
    trigger: "Silent failures & compliance audit",
    consequence: "Ad-hoc retries added; audit table written from worker",
    activeFileIndices: [0, 1, 2, 3, 4, 5],
  },
  {
    time: "Month 8",
    trigger: "Double-submit & contract drift",
    consequence: "6 good decisions that do not know about each other",
    activeFileIndices: [0, 1, 2, 3, 4, 5],
  },
];

const TICK_MS = 2600;

/**
 * SixSystemsDrift proves how a single feature fractures into 6 uncoordinated files.
 */
export function SixSystemsDrift() {
  const tick = useTick(TICK_MS);
  const activeStep = tick === null ? TIMELINE_STEPS.length - 1 : tick % TIMELINE_STEPS.length;
  const currentTimeline = TIMELINE_STEPS[activeStep] ?? TIMELINE_STEPS[0]!;
  const live = tick !== null;

  return (
    <figure
      className="@container not-prose my-6 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Evolution of a signup feature from 1 route file into 6 disparate subsystem files over 8 months."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-rose-500" />
          <p className="text-sm font-medium text-fd-foreground">The 8-month sprawl</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-fd-muted-foreground">
            Stage: <span className="font-semibold text-fd-foreground">{currentTimeline.time}</span>
          </span>
        </div>
      </div>

      <div className="grid gap-px bg-fd-border @min-[44rem]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        {/* Timeline stages column */}
        <div className="flex min-w-0 flex-col justify-between bg-fd-card/50 p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
              Feature Timeline
            </p>
            <div className="flex flex-col gap-2">
              {TIMELINE_STEPS.map((step, idx) => {
                const isCurrent = idx === activeStep;
                return (
                  <div
                    key={step.time}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-xs transition-colors duration-300",
                      isCurrent
                        ? "border-rose-500/40 bg-rose-500/[0.08] text-fd-foreground"
                        : "border-transparent bg-transparent text-fd-muted-foreground/70",
                    )}
                  >
                    <div className="flex items-center justify-between font-mono font-medium">
                      <span>{step.time}</span>
                      {isCurrent && live ? (
                        <span className="relative flex size-1.5 shrink-0" aria-hidden>
                          <BeatPing key={tick} className="bg-rose-500/20" />
                          <span className="size-1.5 rounded-full bg-rose-500" />
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] font-medium text-fd-foreground/90">{step.trigger}</p>
                    <p className="text-[10px] text-fd-muted-foreground">{step.consequence}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-md border border-fd-border/70 bg-fd-background/70 px-3 py-2 text-[11px] text-fd-muted-foreground">
            <span className="font-semibold text-fd-foreground">The dilemma: </span>
            No single file made a bad choice. But 6 files must now implicitly agree on retries,
            idempotency, and audit state.
          </div>
        </div>

        {/* 6 Files Architecture grid */}
        <div className="flex min-w-0 flex-col bg-fd-card p-4 sm:p-5">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
            Active Subsystem Boundaries ({currentTimeline.activeFileIndices.length}/6 files)
          </p>

          <RevealGroup as="div" className="grid grid-cols-1 gap-2 @min-[30rem]:grid-cols-2">
            {FILES.map((file, idx) => {
              const isActive = currentTimeline.activeFileIndices.includes(idx);
              return (
                <RevealItem
                  as="div"
                  key={file.path}
                  className={cn(
                    "flex flex-col justify-between rounded-lg border p-2.5 transition-all duration-300",
                    isActive
                      ? "border-rose-500/35 bg-rose-500/[0.04] opacity-100 shadow-sm"
                      : "border-fd-border/40 bg-fd-secondary/15 opacity-35 grayscale",
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <code className="font-mono text-[11px] font-semibold text-fd-foreground">
                        {file.path}
                      </code>
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          isActive ? "bg-rose-500" : "bg-fd-border",
                        )}
                      />
                    </div>
                    <p className="text-[11px] text-fd-muted-foreground">{file.role}</p>
                  </div>
                  <div className="mt-2 border-t border-fd-border/40 pt-1.5">
                    <p className="text-[10px] leading-tight text-rose-600 dark:text-rose-400">
                      ⚠ {file.risk}
                    </p>
                  </div>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </div>
      </div>
    </figure>
  );
}
