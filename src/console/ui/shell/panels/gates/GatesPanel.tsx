/**
 * Gates panel — two inquiries + evaluate-only simulator (console §9.7).
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import {
  auditLines,
  decodePrincipal,
  formatDenial,
  formatEvaluationStep,
  formatViolation,
  groupFlows,
  groupPrincipals,
  openFlow,
  openPrincipal,
  serializeGatesSearch,
  type GatesListResponse,
  type GatesSearch,
  type PowersResponse,
  type SimulateResponse,
} from "../../../gates/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Input } from "../../components/ui.tsx";

/**
 * Gates panel. Inquiry direction and selection live in URL search params.
 */
export function GatesPanel() {
  const search = useSearch({ from: "/gates" }) as GatesSearch;
  const navigate = useNavigate({ from: "/gates" });
  const from = search.from ?? "flow";
  const [companion, setCompanion] = useState(search.as ?? "");
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [powers, setPowers] = useState<PowersResponse | null>(null);

  const setSearch = (next: GatesSearch) => {
    void navigate({
      search: serializeGatesSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.gates.list"],
    queryFn: async () => {
      const res = await consoleCalls.gatesList();
      if (res.error) throw new Error(res.error.code);
      return res.data as GatesListResponse;
    },
    refetchInterval: 10_000,
  });

  const data = listQuery.data;
  const principals = data?.principals ?? [];
  const flows = data?.flows ?? [];
  const violations = data?.violations ?? [];
  const widenings = data?.widenings ?? [];
  const audit = data?.audit ?? {
    unguardedFlows: [],
    orphanPermissions: [],
    emptyRoles: [],
    unattachedGates: [],
  };
  const lines = useMemo(() => auditLines(audit), [audit]);

  const groups = useMemo(
    () =>
      from === "principal"
        ? groupPrincipals(principals, search.q ?? "")
        : groupFlows(flows, search.q ?? ""),
    [from, principals, flows, search.q],
  );

  const selectedPrincipal = decodePrincipal(search.principal);
  const openPrincipalRow = selectedPrincipal
    ? principals.find((p) => p.kind === selectedPrincipal.kind && p.id === selectedPrincipal.id)
    : undefined;
  const openFlowRow = flows.find((f) => f.flowId === search.flow);

  const simulate = useMutation({
    mutationFn: async () => {
      if (from === "flow") {
        if (!openFlowRow) throw new Error("Select a flow");
        const principal = decodePrincipal(companion || search.as);
        if (!principal) throw new Error("Pick a principal to simulate as");
        const res = await consoleCalls.gatesSimulate({
          flowId: openFlowRow.flowId,
          principal,
        });
        if (res.error) throw new Error(res.error.code);
        return res.data as SimulateResponse;
      }
      if (!selectedPrincipal) throw new Error("Select a principal");
      const flowId = companion || search.as;
      if (!flowId) throw new Error("Pick a flow to simulate");
      const res = await consoleCalls.gatesSimulate({
        flowId,
        principal: selectedPrincipal,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as SimulateResponse;
    },
    onSuccess: (result) => {
      setSimResult(result);
    },
  });

  const powersMut = useMutation({
    mutationFn: async () => {
      if (!selectedPrincipal) throw new Error("Select a principal");
      const res = await consoleCalls.gatesPowers(selectedPrincipal);
      if (res.error) throw new Error(res.error.code);
      return res.data as PowersResponse;
    },
    onSuccess: (result) => {
      setPowers(result);
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-3 border-b border-[var(--oke-line)] px-4 py-3">
        <div>
          <h1 className="text-lg font-medium text-[var(--oke-fg)]">Gates</h1>
          <p className="text-sm text-[var(--oke-muted)]">
            What can this principal do · what guards this flow
          </p>
        </div>
        <div role="group" aria-label="Inquiry direction" className="flex gap-1">
          <Button
            type="button"
            variant={from === "principal" ? "primary" : "ghost"}
            aria-pressed={from === "principal"}
            onClick={() =>
              setSearch({
                ...search,
                from: "principal",
                flow: undefined,
              })
            }
          >
            From principal
          </Button>
          <Button
            type="button"
            variant={from === "flow" ? "primary" : "ghost"}
            aria-pressed={from === "flow"}
            onClick={() =>
              setSearch({
                ...search,
                from: "flow",
                principal: undefined,
              })
            }
          >
            From flow
          </Button>
        </div>
        <label className="ml-auto flex min-w-[12rem] flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter gates</span>
          <Input
            aria-label="Filter gates"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.currentTarget.value || undefined })}
          />
        </label>
      </header>

      {lines.length > 0 ? (
        <section
          aria-label="Continuous security audit"
          className="border-b border-[var(--oke-line)] px-4 py-2"
          role="status"
        >
          <h2 className="sr-only">Standing audit</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--oke-danger)]">
            {lines.map((line) => (
              <li key={line.code}>{line.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {violations.length > 0 ? (
        <section
          aria-label="Plane violations"
          className="border-b border-[var(--oke-line)] bg-[var(--oke-danger)]/10 px-4 py-2"
          role="alert"
        >
          <h2 className="text-sm font-medium text-[var(--oke-danger)]">Two-plane violations</h2>
          <ul className="mt-1 text-sm text-[var(--oke-fg)]">
            {violations.map((v) => (
              <li key={v.operatorId}>{formatViolation(v)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section
          aria-label={from === "principal" ? "Principal list" : "Flow list"}
          className="w-80 shrink-0 overflow-y-auto border-r border-[var(--oke-line)]"
        >
          <h2 className="sr-only">{from === "principal" ? "Principals" : "Flows"}</h2>
          {listQuery.isLoading ? (
            <p className="p-4 text-sm text-[var(--oke-muted)]">Loading…</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.id} aria-label={group.label} className="py-2">
              <h3 className="px-4 py-1 text-xs uppercase tracking-wide text-[var(--oke-muted)]">
                {group.label}
              </h3>
              <ul>
                {group.items.map((item) => {
                  const pressed =
                    from === "flow" ? item.id === search.flow : item.id === search.principal;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={pressed}
                        className={clsx(
                          "flex min-h-10 w-full flex-col items-start px-4 py-2 text-left text-sm",
                          pressed
                            ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
                            : "text-[var(--oke-muted)] hover:text-[var(--oke-fg)]",
                        )}
                        onClick={() => {
                          setSimResult(null);
                          setPowers(null);
                          if (from === "flow") {
                            setSearch(openFlow(search, item.id));
                          } else {
                            const decoded = decodePrincipal(item.id);
                            if (!decoded) return;
                            setSearch(openPrincipal(search, decoded.kind, decoded.id));
                          }
                        }}
                      >
                        <span className="font-mono">{item.label}</span>
                        {item.meta ? <span className="truncate text-xs">{item.meta}</span> : null}
                        {item.flag ? (
                          <span role="status" className="text-xs text-[var(--oke-danger)]">
                            {item.flag}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>

        <section
          aria-label="Gates detail"
          aria-live="polite"
          className="min-w-0 flex-1 overflow-y-auto p-4"
        >
          {!openFlowRow && !openPrincipalRow ? (
            <p className="text-sm text-[var(--oke-muted)]">
              Choose a principal or a flow. The matrix is not the entry point.
            </p>
          ) : (
            <div className="flex max-w-2xl flex-col gap-6">
              {from === "flow" && openFlowRow ? (
                <div>
                  <h2 className="font-mono text-lg text-[var(--oke-fg)]">{openFlowRow.flowId}</h2>
                  <p className="text-sm text-[var(--oke-muted)]">
                    What guards this — registration order
                  </p>
                  {openFlowRow.gates.length === 0 ? (
                    <p className="mt-2 text-sm" role="status">
                      {openFlowRow.unguarded ? "Unguarded — public on the user plane" : "No gates"}
                    </p>
                  ) : (
                    <ol
                      aria-label="Gate chain"
                      className="mt-3 list-decimal space-y-1 pl-5 text-sm"
                    >
                      {openFlowRow.gates.map((g) => (
                        <li key={g}>
                          <code className="font-mono">{g}</code>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : null}

              {from === "principal" && openPrincipalRow ? (
                <div>
                  <h2 className="font-mono text-lg text-[var(--oke-fg)]">
                    {openPrincipalRow.name}
                  </h2>
                  <p className="text-sm text-[var(--oke-muted)]">
                    {openPrincipalRow.kind} · {openPrincipalRow.plane} plane
                    {openPrincipalRow.email ? ` · ${openPrincipalRow.email}` : ""}
                  </p>
                  <h3 className="mt-4 text-sm font-medium">Scopes</h3>
                  <ul aria-label="Scopes" className="mt-1 flex flex-wrap gap-2 text-sm">
                    {openPrincipalRow.scopes.map((s) => (
                      <li key={s}>
                        <code className="font-mono">{s}</code>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-3"
                    onClick={() => powersMut.mutate()}
                  >
                    What can this do
                  </Button>
                  {powers ? (
                    <div className="mt-3 text-sm">
                      <p role="status">
                        {powers.allowedFlowIds.length} flows allowed · {powers.deniedFlowIds.length}{" "}
                        denied
                      </p>
                      <ul aria-label="Allowed flows" className="mt-2 list-disc pl-5">
                        {powers.allowedFlowIds.map((id) => (
                          <li key={id}>
                            <code className="font-mono">{id}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <section aria-label="Simulator" className="border-t border-[var(--oke-line)] pt-4">
                <h3 className="text-sm font-medium text-[var(--oke-fg)]">Simulator</h3>
                <p className="text-sm text-[var(--oke-muted)]">
                  Evaluates the real gate chain only — never runs the handler
                </p>
                <label className="mt-3 flex max-w-md flex-col gap-1 text-sm">
                  <span className="text-[var(--oke-muted)]">
                    {from === "flow" ? "Simulate as principal" : "Simulate against flow"}
                  </span>
                  <select
                    aria-label="Companion selection"
                    className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm text-[var(--oke-fg)]"
                    value={companion}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setCompanion(value);
                      setSearch({
                        ...search,
                        as: value || undefined,
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    {from === "flow"
                      ? principals.map((p) => (
                          <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                            {p.kind}: {p.name}
                          </option>
                        ))
                      : flows
                          .filter((f) => f.plane === "user")
                          .map((f) => (
                            <option key={f.flowId} value={f.flowId}>
                              {f.flowId}
                            </option>
                          ))}
                  </select>
                </label>
                <Button
                  type="button"
                  className="mt-3"
                  onClick={() => simulate.mutate()}
                  disabled={simulate.isPending}
                >
                  Simulate
                </Button>
                {simulate.isError ? (
                  <p role="alert" className="mt-2 text-sm text-[var(--oke-danger)]">
                    {simulate.error instanceof Error ? simulate.error.message : "Simulate failed"}
                  </p>
                ) : null}
                {simResult ? (
                  <div className="mt-4">
                    <ol
                      aria-label="Evaluation order"
                      className="list-decimal space-y-1 pl-5 text-sm"
                    >
                      {simResult.evaluations.map((e, i) => (
                        <li key={`${e.name}-${i}`}>{formatEvaluationStep(e, i)}</li>
                      ))}
                    </ol>
                    <p
                      role="status"
                      className="mt-3 text-sm"
                      data-denial={simResult.denial?.code ?? "allowed"}
                    >
                      {simResult.denial ? formatDenial(simResult.denial) : "Allowed — chain passed"}
                    </p>
                  </div>
                ) : null}
              </section>

              {widenings.length > 0 ? (
                <section aria-label="Permission widenings">
                  <h3 className="text-sm font-medium text-[var(--oke-danger)]">Deploy widenings</h3>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {widenings.map((w) => (
                      <li key={`${w.path}:${w.summary}`}>{w.summary}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
