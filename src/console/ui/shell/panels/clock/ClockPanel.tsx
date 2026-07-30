/**
 * Clock panel — forward timeline, waiting-on, cron health (console §9.6).
 *
 * No preview affordance. DST only when ambiguous. Run-now with external
 * effects follows §10.5 typed confirm.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  filterCrons,
  filterWaitingOn,
  formatHealth,
  formatTimelineWhen,
  formatWakeIn,
  forwardTimeline,
  openCron,
  openWake,
  runNowConfirmation,
  serializeClockSearch,
  validateTypedConfirm,
  waitingOnBanner,
  type ClockListResponse,
  type ClockSearch,
} from "../../../clock/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Input } from "../../components/ui.tsx";
import { displayLabel } from "../../../display.ts";

/**
 * Clock panel. Timeline + waiting-on + schedules; actions through `fx`.
 */
export function ClockPanel() {
  const search = useSearch({ from: "/clock" }) as ClockSearch;
  const navigate = useNavigate({ from: "/clock" });
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [editCron, setEditCron] = useState("");
  const [editEvery, setEditEvery] = useState("");
  const [actionNote, setActionNote] = useState<string | null>(null);

  const setSearch = (next: ClockSearch) => {
    void navigate({
      search: serializeClockSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.clock.list"],
    queryFn: async () => {
      const res = await consoleCalls.clockList();
      if (res.error) throw new Error(res.error.code);
      return res.data as ClockListResponse;
    },
    refetchInterval: 5_000,
  });

  const data = listQuery.data;
  const now = data?.now ?? Date.now();
  const q = search.q ?? "";
  const crons = useMemo(() => filterCrons(data?.crons ?? [], q), [data?.crons, q]);
  const waitingOn = useMemo(() => filterWaitingOn(data?.waitingOn ?? [], q), [data?.waitingOn, q]);
  const timeline = useMemo(() => forwardTimeline(data?.timeline ?? [], now), [data?.timeline, now]);
  const counts = data?.waitingOnCounts ?? [];
  const banner = waitingOnBanner(waitingOn.length, counts);
  const openCronRow = crons.find((c) => c.name === search.cron);
  const openWakeRow = waitingOn.find((w) => w.runId === search.wake);
  const runConfirm = openCronRow ? runNowConfirmation(openCronRow, { production: true }) : null;
  const health = openCronRow ? formatHealth(openCronRow.health) : null;

  useEffect(() => {
    setTyped("");
    setReason("");
    setActionNote(null);
    if (openCronRow) {
      setEditCron(openCronRow.effectiveCron ?? "");
      setEditEvery(openCronRow.effectiveEvery ?? "");
    }
  }, [openCronRow?.name, search.action, openWakeRow?.runId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["console.clock.list"] });

  const runNowMut = useMutation({
    mutationFn: async () => {
      if (!openCronRow || !runConfirm) throw new Error("no cron");
      if (runConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: runConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      }
      const res = await consoleCalls.clockRunNow({
        name: openCronRow.name,
        confirmation: runConfirm.kind === "typed" ? typed : undefined,
        reason: runConfirm.kind === "typed" ? reason : undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: async (d) => {
      setActionNote(d?.ran ? "Ran now" : "Did not acquire lease");
      setTyped("");
      setReason("");
      await invalidate();
    },
    onError: (err) => {
      setActionNote(err instanceof Error ? err.message : "Run failed");
    },
  });

  const pauseMut = useMutation({
    mutationFn: async () => {
      if (!openCronRow) throw new Error("no cron");
      const res = await consoleCalls.clockPause({ name: openCronRow.name });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: async () => {
      setActionNote("Paused");
      await invalidate();
    },
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!openCronRow?.overridable) throw new Error("not overridable");
      const res = await consoleCalls.clockEditSchedule({
        name: openCronRow.name,
        cron: editCron || undefined,
        every: editEvery || undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: async () => {
      setActionNote("Schedule updated");
      setSearch({ ...search, action: undefined });
      await invalidate();
    },
    onError: (err) => {
      setActionNote(err instanceof Error ? err.message : "Edit failed");
    },
  });

  const wakeMut = useMutation({
    mutationFn: async () => {
      if (!openWakeRow) throw new Error("no wake");
      const res = await consoleCalls.clockWakeEarly({
        runId: openWakeRow.runId,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: async () => {
      setActionNote("Woke early");
      setSearch({ ...search, wake: undefined });
      await invalidate();
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--oke-line)] px-4 py-3">
        <h1 className="text-lg font-medium">Clock</h1>
        <p className="text-sm text-[var(--oke-muted)]">Forward timeline, waiting-on, cron health</p>
        <label className="mt-2 block max-w-sm text-sm">
          <span className="sr-only">Filter clock</span>
          <Input
            aria-label="Filter clock"
            placeholder="Filter…"
            value={q}
            onChange={(e) => setSearch({ ...search, q: e.currentTarget.value || undefined })}
          />
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[1fr_1fr_1.2fr]">
        <section
          aria-label="Forward timeline"
          className="min-h-0 overflow-y-auto border-b border-[var(--oke-line)] p-4 lg:border-b-0 lg:border-r"
        >
          <h2 className="mb-2 text-sm font-medium">Next 24 hours</h2>
          {listQuery.isLoading ? (
            <p className="text-sm text-[var(--oke-muted)]">Loading…</p>
          ) : timeline.length === 0 ? (
            <p className="text-sm text-[var(--oke-muted)]">Nothing in the next 24h</p>
          ) : (
            <ol className="space-y-1">
              {timeline.map((e) => (
                <li
                  key={`${e.kind}-${e.name}-${e.at}`}
                  className="flex min-h-8 items-baseline gap-2 text-sm"
                >
                  <span className="w-24 shrink-0 text-[var(--oke-muted)]">
                    {formatTimelineWhen(e.at, now)}
                  </span>
                  <span>
                    {e.kind === "cron" ? "cron" : "wake"} · {e.name}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-label="Waiting on"
          className="min-h-0 overflow-y-auto border-b border-[var(--oke-line)] p-4 lg:border-b-0 lg:border-r"
        >
          <h2 className="mb-1 text-sm font-medium">Waiting on</h2>
          <p className="mb-2 text-sm text-[var(--oke-muted)]" role="status">
            {banner}
          </p>
          <ul className="space-y-1">
            {waitingOn.map((w) => {
              const count = counts.find((c) => c.label === (w.label || "(unlabelled)"))?.count ?? 1;
              return (
                <li key={w.runId}>
                  <button
                    type="button"
                    aria-pressed={w.runId === search.wake}
                    className={clsx(
                      "flex min-h-8 w-full flex-col items-start px-2 py-1 text-left text-sm",
                      w.runId === search.wake
                        ? "bg-[var(--oke-line)]"
                        : "hover:bg-[var(--oke-line)]/40",
                    )}
                    onClick={() => setSearch(openWake(search, w.runId))}
                  >
                    <span>{w.label || w.flow}</span>
                    <span className="text-[var(--oke-muted)]">
                      wake-in {formatWakeIn(w.wakeInMs)}
                      {w.step ? ` · step ${w.step}` : ""}
                      {` · ${count} run${count === 1 ? "" : "s"}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Cron schedules" className="min-h-0 overflow-y-auto p-4">
          <h2 className="mb-2 text-sm font-medium">Schedules</h2>
          <ul className="mb-4 space-y-1">
            {crons.map((c) => {
              const h = formatHealth(c.health);
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    aria-pressed={c.name === search.cron}
                    className={clsx(
                      "flex min-h-8 w-full flex-col items-start px-2 py-1 text-left text-sm",
                      c.name === search.cron
                        ? "bg-[var(--oke-line)]"
                        : "hover:bg-[var(--oke-line)]/40",
                    )}
                    onClick={() => setSearch(openCron(search, c.name))}
                  >
                    <span className="flex items-center gap-1">
                      {displayLabel(c.name, c.description)}
                      {c.external ? <span aria-label="external effect">↗</span> : null}
                      {c.health.overdue ? (
                        <span role="status" className="text-[var(--oke-danger)]">
                          overdue
                        </span>
                      ) : null}
                      {c.dstAmbiguity ? <span role="status">DST {c.dstAmbiguity.kind}</span> : null}
                    </span>
                    <span className="text-[var(--oke-muted)]">
                      {h.drift} · {h.missedWithPolicy} · {h.lease}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {openCronRow && health ? (
            <section
              aria-label="Cron detail"
              aria-live="polite"
              className="space-y-3 border-t border-[var(--oke-line)] pt-3"
            >
              <h3 className="text-base font-medium">
                {displayLabel(openCronRow.name, openCronRow.description)}
              </h3>
              <p className="text-sm text-[var(--oke-muted)]">
                {openCronRow.description ? (
                  <span className="font-mono">{openCronRow.name}</span>
                ) : null}
                {openCronRow.description ? " · " : ""}
                {openCronRow.effectiveCron ?? openCronRow.effectiveEvery} · {openCronRow.timezone}
                {openCronRow.status !== "active" ? ` · ${openCronRow.status}` : ""}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-[var(--oke-muted)]">Drift</dt>
                  <dd>{health.drift}</dd>
                </div>
                <div>
                  <dt className="text-[var(--oke-muted)]">Overdue</dt>
                  <dd>{health.overdue}</dd>
                </div>
                <div>
                  <dt className="text-[var(--oke-muted)]">Missed + catch-up</dt>
                  <dd>{health.missedWithPolicy}</dd>
                </div>
                <div>
                  <dt className="text-[var(--oke-muted)]">Lease</dt>
                  <dd>{health.lease}</dd>
                </div>
              </dl>
              {openCronRow.dstAmbiguity ? (
                <p role="alert" className="text-sm">
                  {openCronRow.dstAmbiguity.reason}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={openCronRow.external ? "external" : "primary"}
                  disabled={runNowMut.isPending}
                  onClick={() => {
                    if (runConfirm?.kind === "typed" && search.action !== "run") {
                      setSearch({ ...search, action: "run" });
                      return;
                    }
                    runNowMut.mutate();
                  }}
                >
                  Run now
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pauseMut.isPending || openCronRow.status === "paused"}
                  onClick={() => pauseMut.mutate()}
                >
                  Pause
                </Button>
                {openCronRow.overridable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setSearch({
                        ...search,
                        action: search.action === "edit" ? undefined : "edit",
                      })
                    }
                  >
                    Edit schedule
                  </Button>
                ) : null}
              </div>

              {search.action === "run" && runConfirm?.kind === "typed" ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    This cron has an external effect. Type <strong>RUN</strong> and a reason.
                  </p>
                  <label className="block text-sm">
                    Type RUN to confirm
                    <Input
                      aria-label="Type RUN to confirm"
                      value={typed}
                      onChange={(e) => setTyped(e.currentTarget.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Reason
                    <Input
                      aria-label="Reason"
                      value={reason}
                      onChange={(e) => setReason(e.currentTarget.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="external"
                    disabled={runNowMut.isPending}
                    onClick={() => runNowMut.mutate()}
                  >
                    Confirm run now
                  </Button>
                </div>
              ) : null}

              {search.action === "edit" && openCronRow.overridable ? (
                <div className="space-y-2">
                  <label className="block text-sm">
                    Cron expression
                    <Input
                      aria-label="Cron expression"
                      value={editCron}
                      onChange={(e) => setEditCron(e.currentTarget.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Every interval
                    <Input
                      aria-label="Every interval"
                      value={editEvery}
                      onChange={(e) => setEditEvery(e.currentTarget.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={editMut.isPending}
                    onClick={() => editMut.mutate()}
                  >
                    Save schedule
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {openWakeRow ? (
            <section
              aria-label="Wake detail"
              aria-live="polite"
              className="mt-4 space-y-2 border-t border-[var(--oke-line)] pt-3"
            >
              <h3 className="text-base font-medium">{openWakeRow.label || openWakeRow.flow}</h3>
              <p className="text-sm text-[var(--oke-muted)]">
                {openWakeRow.flow} · wake in {formatWakeIn(openWakeRow.wakeInMs)}
                {openWakeRow.step ? ` · step ${openWakeRow.step}` : ""}
              </p>
              <Button type="button" disabled={wakeMut.isPending} onClick={() => wakeMut.mutate()}>
                Wake early
              </Button>
            </section>
          ) : null}

          {actionNote ? (
            <p className="mt-3 text-sm" role="status">
              {actionNote}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
