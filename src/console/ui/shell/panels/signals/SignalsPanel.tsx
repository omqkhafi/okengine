/**
 * Signals panel — one list grouped by delivery physics (console §9.4).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  closeDeadLetter,
  closeSignal,
  createLiveMonitor,
  discardConfirmation,
  dryRunOffer,
  durableLine,
  exportLivePayloads,
  fieldsFromSchema,
  formValuesToPayload,
  groupByPhysics,
  onMonitorScroll,
  openDeadLetter,
  openSignal,
  payloadToFormValues,
  replayConfirmation,
  serializeSignalsSearch,
  setPaused,
  validateTypedConfirm,
  type LiveMonitorState,
  type SignalRecord,
  type SignalsSearch,
} from "../../../signals/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button } from "../../components/ui.tsx";

/**
 * Signals panel. List + detail + DLQ state lives in URL search params.
 */
export function SignalsPanel() {
  const search = useSearch({ from: "/signals" }) as SignalsSearch;
  const navigate = useNavigate({ from: "/signals" });
  const qc = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [dryRunSummary, setDryRunSummary] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<LiveMonitorState>(() => createLiveMonitor());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setSearch = (next: SignalsSearch) => {
    void navigate({
      search: serializeSignalsSearch(next) as never,
      replace: true,
    });
  };

  const rate = search.rate ?? 10;

  const signalsQuery = useQuery({
    queryKey: ["console.signals.list"],
    queryFn: async () => {
      const res = await consoleCalls.signalsList();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { signals: SignalRecord[] }).signals;
    },
    refetchInterval: search.paused ? false : 5_000,
  });

  const signals = signalsQuery.data ?? [];
  const groups = useMemo(() => groupByPhysics(signals, search.q ?? ""), [signals, search.q]);
  const open = signals.find((s) => s.name === search.signal);
  const line = open ? durableLine(open.consumersDurable) : null;
  const dlq = open?.deadLetters.find((d) => d.id === search.dlq);
  const fields = open ? fieldsFromSchema(open.schema) : [];
  const replayConfirm = open ? replayConfirmation(open, { production: true }) : null;
  const discardConfirm = open ? discardConfirmation(open, { production: true }) : null;
  const dryOffer = open ? dryRunOffer(open) : null;

  useEffect(() => {
    if (!dlq) return;
    setFormValues(payloadToFormValues(dlq.payload, fields));
    setTyped("");
    setReason("");
  }, [dlq?.id, open?.name]);

  useEffect(() => {
    if (!open || open.delivery !== "live") return;
    if (search.paused) {
      setMonitor((m) => setPaused(m, true));
      return;
    }
    setMonitor((m) => ({
      ...setPaused(m, false),
      payloads: m.payloads.length === 0 ? [...open.recentLive] : m.payloads,
    }));
  }, [open?.name, open?.recentLive, open?.delivery, search.paused]);

  const dryRun = useMutation({
    mutationFn: async () => {
      if (!open) return;
      if (dryOffer && !dryOffer.ok) {
        throw new Error(dryOffer.reason);
      }
      const ids = selectedIds.size > 0 ? [...selectedIds] : open.deadLetters.map((d) => d.id);
      const res = await consoleCalls.signalsDryRunReplay({
        signal: open.name,
        messageIds: ids,
        subscriberId: search.sub,
        ratePerSec: rate,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: (data) => {
      if (!data) return;
      const stubs =
        data.wouldHaveFired?.length > 0
          ? ` · ${data.wouldHaveFired.length} external effect(s) stubbed`
          : "";
      setDryRunSummary(`${data.succeeded} would succeed, ${data.failed} would still fail${stubs}`);
    },
    onError: (err) => {
      setDryRunSummary(err instanceof Error ? err.message : "Dry-run refused");
    },
  });

  const replay = useMutation({
    mutationFn: async () => {
      if (!open || !replayConfirm) return;
      if (replayConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: replayConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      }
      const ids =
        selectedIds.size > 0
          ? [...selectedIds]
          : dlq
            ? [dlq.id]
            : open.deadLetters.map((d) => d.id);
      const payloads =
        dlq && fields ? { [dlq.id]: formValuesToPayload(formValues, fields) } : undefined;
      const res = await consoleCalls.signalsReplay({
        signal: open.name,
        messageIds: ids,
        subscriberId: search.sub,
        ratePerSec: rate,
        dryRun: false,
        payloads,
        confirmation: replayConfirm.kind === "typed" ? typed : undefined,
        reason: replayConfirm.kind === "typed" ? reason : undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["console.signals.list"] });
      setDryRunSummary(null);
      setSelectedIds(new Set());
    },
  });

  const discard = useMutation({
    mutationFn: async () => {
      if (!open || !discardConfirm) return;
      if (discardConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: discardConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      }
      const ids =
        selectedIds.size > 0
          ? [...selectedIds]
          : dlq
            ? [dlq.id]
            : open.deadLetters.map((d) => d.id);
      const res = await consoleCalls.signalsDiscard({
        signal: open.name,
        messageIds: ids,
        confirmation: discardConfirm.kind === "typed" ? typed : undefined,
        reason: discardConfirm.kind === "typed" ? reason : undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["console.signals.list"] });
      if (dlq) setSearch(closeDeadLetter(search));
      setSelectedIds(new Set());
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-4 border-b border-[var(--oke-line)] px-6 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">Signals</p>
          <h1 className="text-xl font-semibold tracking-tight">Delivery physics</h1>
          <p className="text-xs text-[var(--oke-muted)]">One list — once · broadcast · live</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter</span>
          <input
            aria-label="Filter signals"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.target.value || undefined })}
          />
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section
          aria-label="Signal list"
          className="min-h-0 overflow-auto border-r border-[var(--oke-line)]"
        >
          {signalsQuery.isLoading ? (
            <p className="px-6 py-8 text-sm text-[var(--oke-muted)]">Loading signals…</p>
          ) : groups.length === 0 ? (
            <p className="px-6 py-8 text-sm text-[var(--oke-muted)]">No signals declared.</p>
          ) : (
            groups.map((group) => (
              <section
                key={group.delivery}
                aria-label={group.label}
                className="border-b border-[var(--oke-line)]"
              >
                <h2 className="sticky top-0 bg-[var(--oke-bg)] px-6 py-2 text-xs font-medium uppercase tracking-[0.15em] text-[var(--oke-muted)]">
                  {group.label}
                </h2>
                <ul>
                  {group.signals.map((s) => (
                    <li key={s.name}>
                      <button
                        type="button"
                        aria-pressed={s.name === search.signal}
                        className={clsx(
                          "flex w-full min-h-10 flex-col items-start gap-0.5 px-6 py-2 text-left text-sm",
                          s.name === search.signal
                            ? "bg-[var(--oke-line)]/40"
                            : "hover:bg-[var(--oke-line)]/20",
                        )}
                        onClick={() => setSearch(openSignal(search, s.name))}
                      >
                        <span className="font-medium">
                          {s.name}
                          {s.orphaned ? (
                            <span role="status" className="ml-2 text-xs text-[var(--oke-muted)]">
                              orphaned
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-[var(--oke-muted)]">
                          {s.delivery === "once" && (
                            <>
                              pending {s.pending} · in-flight {s.inflight} · DLQ {s.dead}
                              {s.outboxLagMs != null && s.outboxLagMs > 0
                                ? ` · outbox ${s.outboxLagMs}ms`
                                : ""}
                            </>
                          )}
                          {s.delivery === "broadcast" && (
                            <>
                              {s.subscribers.length} subscribers · lag{" "}
                              {s.subscribers.reduce((a, x) => a + x.lag, 0)}
                            </>
                          )}
                          {s.delivery === "live" && (
                            <>
                              {s.connections} connections · {s.throughputPerSec}
                              /s
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </section>

        <section
          aria-label="Signal detail"
          aria-live="polite"
          className="min-h-0 overflow-auto px-6 py-4"
        >
          {!open || !line ? (
            <p className="text-sm text-[var(--oke-muted)]">
              Select a signal to inspect delivery, DLQ, and consumers.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{open.name}</h2>
                  <p
                    role="status"
                    className="mt-2 max-w-prose text-sm leading-relaxed"
                    data-durable={String(line.durable)}
                  >
                    {line.statement}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSearch(closeSignal(search))}
                >
                  Close
                </Button>
              </div>

              {open.delivery === "once" ? (
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-[var(--oke-muted)]">Pending</dt>
                    <dd className="text-lg font-medium">{open.pending}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--oke-muted)]">In-flight</dt>
                    <dd className="text-lg font-medium">{open.inflight}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--oke-muted)]">DLQ</dt>
                    <dd className="text-lg font-medium">{open.dead}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--oke-muted)]">Retry policy</dt>
                    <dd className="text-lg font-medium">
                      {open.retries} retries
                      {open.deadLetterEnabled ? " → DLQ" : ""}
                    </dd>
                  </div>
                  {open.outboxLagMs != null ? (
                    <div className="col-span-2">
                      <dt className="text-[var(--oke-muted)]">Outbox lag</dt>
                      <dd className="font-medium">{open.outboxLagMs} ms</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {open.delivery === "broadcast" ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Subscribers</h3>
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Per-subscriber lag and errors</caption>
                    <thead>
                      <tr className="text-[var(--oke-muted)]">
                        <th scope="col" className="py-1 font-normal">
                          Subscriber
                        </th>
                        <th scope="col" className="py-1 font-normal">
                          Lag
                        </th>
                        <th scope="col" className="py-1 font-normal">
                          Errors
                        </th>
                        <th scope="col" className="py-1 font-normal">
                          Replay
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.subscribers.map((sub) => (
                        <tr key={sub.id} className="border-t border-[var(--oke-line)]">
                          <td className="py-2 font-mono text-xs">{sub.id}</td>
                          <td className="py-2">{sub.lag}</td>
                          <td className="py-2">{sub.errorCount}</td>
                          <td className="py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              aria-pressed={search.sub === sub.id}
                              onClick={() =>
                                setSearch({
                                  ...search,
                                  sub: search.sub === sub.id ? undefined : sub.id,
                                })
                              }
                            >
                              {search.sub === sub.id ? "Targeted" : "Target"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {open.delivery === "live" ? (
                <section aria-label="Payload monitor" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-medium">Payload monitor</h3>
                    <span className="text-xs text-[var(--oke-muted)]">
                      {open.connections} connections · {open.throughputPerSec}/s
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const next = !monitor.paused;
                        setMonitor((m) => setPaused(m, next));
                        setSearch({
                          ...search,
                          paused: next || undefined,
                        });
                      }}
                    >
                      {monitor.paused ? "Resume" : "Pause"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const blob = new Blob([exportLivePayloads(monitor.payloads)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${open.name}-live.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Export
                    </Button>
                    {monitor.autoPausedByScroll ? (
                      <span role="status" className="text-xs text-[var(--oke-muted)]">
                        Auto-paused on scroll
                      </span>
                    ) : null}
                  </div>
                  <ul
                    className="max-h-48 overflow-auto border border-[var(--oke-line)] p-2 font-mono text-xs"
                    onScroll={() => {
                      setMonitor((m) => {
                        const next = onMonitorScroll(m);
                        if (next.paused && !m.paused) {
                          setSearch({ ...search, paused: true });
                        }
                        return next;
                      });
                    }}
                  >
                    {(monitor.payloads.length ? monitor.payloads : open.recentLive).map((p, i) => (
                      <li key={i} className="border-b border-[var(--oke-line)]/50 py-1">
                        {JSON.stringify(p)}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section aria-label="Producers and consumers">
                <h3 className="mb-2 text-sm font-medium">Causality</h3>
                <div className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--oke-muted)]">
                      Producers
                    </p>
                    <ul className="flex flex-col gap-1">
                      {open.producers.length === 0 ? (
                        <li className="text-[var(--oke-muted)]">None</li>
                      ) : (
                        open.producers.map((p) => (
                          <li key={p.flowId}>
                            <Link
                              to="/flows"
                              search={{
                                sel: "flow",
                                flow: p.flowId,
                              }}
                              className="underline-offset-2 hover:underline"
                            >
                              {p.flowId}
                            </Link>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--oke-muted)]">
                      Consumers
                    </p>
                    <ul className="flex flex-col gap-1">
                      {open.consumers.length === 0 ? (
                        <li className="text-[var(--oke-muted)]">None</li>
                      ) : (
                        open.consumers.map((c) => (
                          <li key={c.flowId}>
                            <Link
                              to="/flows"
                              search={{
                                sel: "flow",
                                flow: c.flowId,
                              }}
                              className="underline-offset-2 hover:underline"
                            >
                              {c.flowId}
                              {c.durable ? " · durable" : ""}
                            </Link>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {open.dead > 0 ? (
                <section aria-label="Dead letters" className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium">Dead letters ({open.dead})</h3>
                  <p className="text-xs text-[var(--oke-muted)]">
                    Bulk repair: dry run first, then replay at a controlled rate — never an
                    unthrottled flood.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-[var(--oke-muted)]">Rate (per second)</span>
                      <input
                        aria-label="Replay rate (per second)"
                        type="number"
                        min={1}
                        max={1000}
                        className="min-h-8 w-24 border border-[var(--oke-line)] bg-transparent px-2"
                        value={rate}
                        onChange={(e) =>
                          setSearch({
                            ...search,
                            rate: Number(e.target.value) || 10,
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      onClick={() => dryRun.mutate()}
                      disabled={dryRun.isPending || (dryOffer !== null && !dryOffer.ok)}
                      title={dryOffer && !dryOffer.ok ? dryOffer.reason : undefined}
                    >
                      Dry run
                    </Button>
                    {dryOffer && !dryOffer.ok ? (
                      <p role="status" className="basis-full text-xs text-[var(--oke-muted)]">
                        {dryOffer.reason}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => replay.mutate()}
                      disabled={replay.isPending || !dryRunSummary}
                    >
                      Replay
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => discard.mutate()}
                      disabled={discard.isPending}
                    >
                      Discard
                    </Button>
                  </div>
                  {dryRunSummary ? (
                    <p role="status" className="text-sm">
                      {dryRunSummary}
                    </p>
                  ) : null}
                  {(replayConfirm?.kind === "typed" || discardConfirm?.kind === "typed") && (
                    <div className="flex flex-col gap-2 border border-[var(--oke-line)] p-3">
                      <p className="text-xs text-[var(--oke-muted)]">
                        This action re-triggers external effects or permanently discards messages.
                        Type the phrase and a reason.
                      </p>
                      <label className="flex flex-col gap-1 text-sm">
                        Confirmation
                        <input
                          aria-label="Confirmation phrase"
                          className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          placeholder={
                            replayConfirm?.kind === "typed"
                              ? replayConfirm.phrase
                              : discardConfirm?.kind === "typed"
                                ? discardConfirm.phrase
                                : ""
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Reason
                        <input
                          aria-label="Confirmation reason"
                          className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <ul className="flex flex-col gap-1">
                    {open.deadLetters.map((d) => {
                      const last = d.failures[d.failures.length - 1];
                      return (
                        <li key={d.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${d.id}`}
                            checked={selectedIds.has(d.id)}
                            onChange={(e) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(d.id);
                                else next.delete(d.id);
                                return next;
                              });
                            }}
                          />
                          <button
                            type="button"
                            aria-pressed={d.id === search.dlq}
                            className="min-h-8 flex-1 text-left text-sm"
                            onClick={() => setSearch(openDeadLetter(search, d.id))}
                          >
                            <span className="font-mono text-xs">{d.id}</span>
                            {last ? (
                              <span role="status" className="ml-2">
                                {last.code}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {dlq ? (
                <section
                  aria-label="Dead-letter detail"
                  className="flex flex-col gap-3 border-t border-[var(--oke-line)] pt-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Dead letter {dlq.id}</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSearch(closeDeadLetter(search))}
                    >
                      Close letter
                    </Button>
                  </div>
                  <p role="status" className="text-sm">
                    {line.statement}
                  </p>
                  <form
                    aria-label="Editable payload"
                    className="flex flex-col gap-2"
                    onSubmit={(e) => e.preventDefault()}
                  >
                    {fields.length > 0 ? (
                      fields.map((f) => (
                        <label key={f.key} className="flex flex-col gap-1 text-sm">
                          {f.key}
                          {f.enumValues ? (
                            <select
                              aria-label={f.key}
                              className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
                              value={formValues[f.key] ?? ""}
                              onChange={(e) =>
                                setFormValues((v) => ({
                                  ...v,
                                  [f.key]: e.target.value,
                                }))
                              }
                            >
                              {f.enumValues.map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              aria-label={f.key}
                              className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
                              value={formValues[f.key] ?? ""}
                              onChange={(e) =>
                                setFormValues((v) => ({
                                  ...v,
                                  [f.key]: e.target.value,
                                }))
                              }
                            />
                          )}
                        </label>
                      ))
                    ) : (
                      <label className="flex flex-col gap-1 text-sm">
                        Payload JSON
                        <textarea
                          aria-label="Payload JSON"
                          className="min-h-24 border border-[var(--oke-line)] bg-transparent px-2 font-mono text-xs"
                          value={formValues._raw ?? ""}
                          onChange={(e) => setFormValues({ _raw: e.target.value })}
                          rows={4}
                        />
                      </label>
                    )}
                  </form>
                  <div>
                    <h4 className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--oke-muted)]">
                      Attempt history
                    </h4>
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {dlq.failures.map((f) => (
                        <li key={`${f.attempt}-${f.code}-${f.at}`}>
                          Attempt {f.attempt}: <strong>{f.code}</strong> — {f.message}
                        </li>
                      ))}
                    </ol>
                  </div>
                  {dlq.causeRunId ? (
                    <p className="text-sm">
                      Causal chain:{" "}
                      <Link
                        to="/traces"
                        search={{ trace: dlq.causeRunId }}
                        className="underline-offset-2 hover:underline"
                      >
                        {dlq.causeFlow ?? dlq.causeRunId}
                      </Link>
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        setSelectedIds(new Set([dlq.id]));
                        replay.mutate();
                      }}
                    >
                      Replay this message
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setSelectedIds(new Set([dlq.id]));
                        discard.mutate();
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
