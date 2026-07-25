/**
 * Overview panel — ranked union of every other panel (console §9.16).
 *
 * Pure aggregator: fetches each panel's projection and composes. No
 * destructive actions, no preview affordance.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { clsx } from "clsx";
import type { Manifest } from "../../../../../manifest/types.ts";
import type { AiListResponse } from "../../../ai/types.ts";
import type { ChannelsListResponse } from "../../../channels/types.ts";
import type { ClockListResponse } from "../../../clock/types.ts";
import type { DiffListResponse } from "../../../diff/types.ts";
import type { GatesListResponse } from "../../../gates/types.ts";
import {
  composeOverview,
  formatBudgetDuration,
  formatBurnRate,
  type OverviewView,
} from "../../../overview/index.ts";
import { rowToRun } from "../../../runs/project.ts";
import type { SignalRecord } from "../../../signals/types.ts";
import type { VaultListResponse } from "../../../vault/types.ts";
import { consoleCalls } from "../../client.ts";

/**
 * Overview panel.
 */
export function OverviewPanel() {
  const manifestQuery = useQuery({
    queryKey: ["console.manifest.get"],
    queryFn: async () => {
      const res = await consoleCalls.manifestGet();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { manifest: Manifest }).manifest;
    },
  });

  const runsQuery = useQuery({
    queryKey: ["console.runs.list"],
    queryFn: async () => {
      const res = await consoleCalls.runsList();
      if (res.error) throw new Error(res.error.code);
      const data = res.data as { runs: Parameters<typeof rowToRun>[0][] };
      return data.runs.map(rowToRun);
    },
    refetchInterval: 10_000,
  });

  const gatesQuery = useQuery({
    queryKey: ["console.gates.list"],
    queryFn: async () => {
      const res = await consoleCalls.gatesList();
      if (res.error) throw new Error(res.error.code);
      return res.data as GatesListResponse;
    },
    refetchInterval: 15_000,
  });

  const signalsQuery = useQuery({
    queryKey: ["console.signals.list"],
    queryFn: async () => {
      const res = await consoleCalls.signalsList();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { signals: SignalRecord[] }).signals;
    },
    refetchInterval: 10_000,
  });

  const clockQuery = useQuery({
    queryKey: ["console.clock.list"],
    queryFn: async () => {
      const res = await consoleCalls.clockList();
      if (res.error) throw new Error(res.error.code);
      return res.data as ClockListResponse;
    },
    refetchInterval: 10_000,
  });

  const vaultQuery = useQuery({
    queryKey: ["console.vault.list"],
    queryFn: async () => {
      const res = await consoleCalls.vaultList();
      if (res.error) throw new Error(res.error.code);
      return res.data as VaultListResponse;
    },
    refetchInterval: 30_000,
  });

  const channelsQuery = useQuery({
    queryKey: ["console.channel.list"],
    queryFn: async () => {
      const res = await consoleCalls.channelsList();
      if (res.error) throw new Error(res.error.code);
      return res.data as ChannelsListResponse;
    },
    refetchInterval: 15_000,
  });

  const aiQuery = useQuery({
    queryKey: ["console.ai.list"],
    queryFn: async () => {
      const res = await consoleCalls.aiList();
      if (res.error) throw new Error(res.error.code);
      return res.data as AiListResponse;
    },
    refetchInterval: 15_000,
  });

  const diffQuery = useQuery({
    queryKey: ["console.diff.list"],
    queryFn: async () => {
      const res = await consoleCalls.diffList();
      if (res.error) throw new Error(res.error.code);
      return res.data as DiffListResponse;
    },
    refetchInterval: 15_000,
  });

  const view = useMemo(() => {
    const now = clockQuery.data?.now ?? Date.now();
    return composeOverview({
      manifest: manifestQuery.data ?? null,
      runs: runsQuery.data ?? [],
      gates: gatesQuery.data ?? null,
      signals: signalsQuery.data ?? [],
      clock: clockQuery.data ?? null,
      vault: vaultQuery.data ?? null,
      channels: channelsQuery.data ?? null,
      ai: aiQuery.data ?? null,
      diff: diffQuery.data ?? null,
      now,
    });
  }, [
    manifestQuery.data,
    runsQuery.data,
    gatesQuery.data,
    signalsQuery.data,
    clockQuery.data,
    vaultQuery.data,
    channelsQuery.data,
    aiQuery.data,
    diffQuery.data,
  ]);

  const loading =
    manifestQuery.isLoading ||
    runsQuery.isLoading ||
    gatesQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-[var(--oke-line)] px-6 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">
          Overview
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--oke-fg)]">
          Is the system healthy right now?
        </h1>
        <p
          role="status"
          aria-live="polite"
          className={clsx(
            "mt-3 text-base leading-snug",
            view.verdict.tone === "critical" && "text-red-700",
            view.verdict.tone === "warn" && "text-amber-800",
            view.verdict.tone === "ok" && "text-[var(--oke-fg)]",
            view.verdict.tone === "empty" && "text-[var(--oke-muted)]",
          )}
        >
          {loading ? "Loading panel projections…" : view.verdict.line}
        </p>
      </header>

      <main id="overview-main" className="flex flex-col gap-8 px-6 py-6">
        {view.hasDeclaredSlos ? (
          <BudgetStrip
            label="Error budgets"
            ariaLabel="Error budgets"
            items={view.slos.map((s) => ({
              id: s.id,
              title: `${s.kind}:${s.name}`,
              meta: s.availability,
              burn: s.burnRate,
              exhaust: s.timeToExhaustionMs,
              badge: s.ceremonial ? "CEREMONIAL" : null,
              remaining: s.remainingBudgetFraction,
            }))}
          />
        ) : null}

        <BudgetStrip
          label="Cost budgets"
          ariaLabel="Cost budgets"
          empty="No cost budgets declared."
          items={view.costBudgets.map((c) => ({
            id: c.id,
            title: c.name,
            meta: `$${c.spent.toFixed(2)} / $${c.declaredBudget.toFixed(2)}`,
            burn: c.burnRate,
            exhaust: c.timeToExhaustionMs,
            badge: null,
            remaining: c.remainingFraction,
          }))}
        />

        <section aria-label="What changed" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--oke-fg)]">
            What changed
          </h2>
          <p className="text-sm text-[var(--oke-muted)]">
            <a
              href={view.whatChanged.href}
              className="underline decoration-[var(--oke-line)] underline-offset-2 hover:text-[var(--oke-fg)]"
            >
              {view.whatChanged.line}
            </a>
          </p>
        </section>

        <FindingsList view={view} />

        <GoldenStrip view={view} />

        {view.firstSloInvite ? (
          <section
            aria-label="Declare first SLO"
            className="flex flex-col gap-2 border border-[var(--oke-line)] px-4 py-3"
          >
            <h2 className="text-sm font-medium text-[var(--oke-fg)]">
              Declare a first objective
            </h2>
            <p className="text-sm text-[var(--oke-muted)]">
              Your busiest flow is{" "}
              <a
                href={view.firstSloInvite.href}
                className="font-mono text-[var(--oke-fg)] underline decoration-[var(--oke-line)] underline-offset-2"
              >
                {view.firstSloInvite.busiestFlow}
              </a>{" "}
              ({view.firstSloInvite.runCount.toLocaleString("en-US")} runs).
              Add{" "}
              <code className="font-mono text-[13px] text-[var(--oke-fg)]">
                {'slo: { availability: "99.9%" }'}
              </code>{" "}
              on that flow.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function BudgetStrip(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly empty?: string;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly meta: string;
    readonly burn: number;
    readonly exhaust: number | null;
    readonly badge: string | null;
    readonly remaining: number;
  }>;
}) {
  return (
    <section aria-label={props.ariaLabel} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--oke-fg)]">
        {props.label}
      </h2>
      {props.items.length === 0 ? (
        <p className="text-sm text-[var(--oke-muted)]">
          {props.empty ?? "None."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--oke-line)] border-y border-[var(--oke-line)]">
          {props.items.map((item) => (
            <li
              key={item.id}
              className="flex min-h-10 flex-wrap items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-[13px] text-[var(--oke-fg)]">
                  {item.title}
                </span>
                <span className="text-[var(--oke-muted)]">{item.meta}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[var(--oke-muted)]">
                <span>
                  burn{" "}
                  <span className="text-[var(--oke-fg)]">
                    {formatBurnRate(item.burn)}
                  </span>
                </span>
                <span>
                  exhausts{" "}
                  <span className="text-[var(--oke-fg)]">
                    {formatBudgetDuration(item.exhaust)}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-16 overflow-hidden bg-[var(--oke-line)]"
                  title={`${Math.round(item.remaining * 100)}% remaining`}
                >
                  <span
                    className="block h-full bg-[var(--oke-fg)]"
                    style={{
                      width: `${Math.max(0, Math.min(100, item.remaining * 100))}%`,
                    }}
                  />
                </span>
                {item.badge ? (
                  <span
                    role="status"
                    className="text-xs uppercase tracking-wider text-[var(--oke-muted)]"
                  >
                    {item.badge}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingsList({ view }: { readonly view: OverviewView }) {
  return (
    <section aria-label="Findings" aria-live="polite" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--oke-fg)]">Findings</h2>
      {view.findings.length === 0 ? (
        <p className="text-sm text-[var(--oke-muted)]">
          No findings from other panels.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--oke-line)] border-y border-[var(--oke-line)]">
          {view.findings.map((f, i) => (
            <li key={f.id} className="py-2 text-sm">
              <a
                href={f.href}
                className="flex min-h-8 items-start gap-3 hover:text-[var(--oke-fg)]"
              >
                <span className="w-5 shrink-0 text-[var(--oke-muted)]">
                  {i + 1}.
                </span>
                <span>
                  <span className="text-[var(--oke-fg)]">{f.title}</span>
                  <span className="text-[var(--oke-muted)]">
                    {" "}
                    · {f.detail}
                  </span>
                  <span className="ml-2 text-xs uppercase tracking-wider text-[var(--oke-muted)]">
                    {f.source}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function GoldenStrip({ view }: { readonly view: OverviewView }) {
  return (
    <section aria-label="Golden signals" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--oke-fg)]">
        Golden signals
      </h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-[var(--oke-muted)]">
            Latency p99
          </dt>
          <dd className="mt-1 text-sm text-[var(--oke-fg)]">
            {Math.round(view.golden.latencyP99Ms)} ms
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-[var(--oke-muted)]">
            Traffic
          </dt>
          <dd className="mt-1 text-sm text-[var(--oke-fg)]">
            {view.golden.trafficPerMin.toFixed(1)} / min
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-[var(--oke-muted)]">
            Errors
          </dt>
          <dd className="mt-1 text-sm text-[var(--oke-fg)]">
            {(view.golden.errorRate * 100).toFixed(2)}%
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-[var(--oke-muted)]">
            Saturation
          </dt>
          <dd className="mt-1 text-sm text-[var(--oke-fg)]">
            {(view.golden.saturation * 100).toFixed(1)}%
          </dd>
        </div>
      </dl>
    </section>
  );
}
