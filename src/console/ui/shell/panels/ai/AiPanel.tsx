/**
 * AI panel — distributions per prompt version (console §9.10).
 *
 * No "try this prompt" / "test the agent" affordances — those would be
 * real ask/run with cost; the spec did not request them.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useMemo } from "react";
import {
  allowPiiStanding,
  distributionSummary,
  filterAgents,
  filterPrompts,
  formatCost,
  formatEval,
  formatLatency,
  formatPromotionBlockers,
  formatRate,
  manifestDiffHref,
  maxBucketCount,
  openAgentRun,
  openPromptVersion,
  promotionDecision,
  runsForAgent,
  serializeAiSearch,
  trailStatusLabel,
  versionsForPrompt,
  type AiListResponse,
  type AiSearch,
  type PromptVersionMetrics,
} from "../../../ai/index.ts";
import { consoleCalls } from "../../client.ts";

/**
 * AI panel.
 */
export function AiPanel() {
  const search = useSearch({ from: "/ai" }) as AiSearch;
  const navigate = useNavigate({ from: "/ai" });

  const setSearch = (next: AiSearch) => {
    void navigate({
      search: serializeAiSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.ai.list"],
    queryFn: async () => {
      const res = await consoleCalls.aiList();
      if (res.error) throw new Error(res.error.code);
      return res.data as AiListResponse;
    },
    refetchInterval: 10_000,
  });

  const data = listQuery.data;
  const prompts = useMemo(
    () => filterPrompts(data?.prompts ?? [], search.q),
    [data?.prompts, search.q],
  );
  const agents = useMemo(
    () => filterAgents(data?.agents ?? [], search.q),
    [data?.agents, search.q],
  );
  const promptName = search.prompt ?? prompts[0]?.name;
  const versions = useMemo(
    () => (promptName ? versionsForPrompt(data?.versions ?? [], promptName) : []),
    [data?.versions, promptName],
  );
  const selectedVersion =
    versions.find((v) => v.version === search.version) ?? versions[versions.length - 1];
  const baseline = versions.length >= 2 ? versions[versions.length - 2] : versions[0];
  const decision =
    baseline && selectedVersion && baseline.version !== selectedVersion.version
      ? promotionDecision(baseline, selectedVersion)
      : null;

  const agentName = search.agent ?? agents[0]?.name;
  const agentRuns = useMemo(
    () => (agentName ? runsForAgent(data?.agentRuns ?? [], agentName) : []),
    [data?.agentRuns, agentName],
  );
  const openRun = agentRuns.find((r) => r.id === search.run) ?? agentRuns[0];
  const pii = allowPiiStanding(data?.allowPii ?? []);
  const cataloguePrompt = prompts.find((p) => p.name === promptName);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--oke-line)] px-4 py-3">
        <h1 className="text-base font-medium text-[var(--oke-fg)]">AI</h1>
        <p className="text-sm text-[var(--oke-muted)]">
          Distributions per prompt version — cost, latency, eval score. Schema-invalid is its own
          class.
        </p>
        <label className="mt-2 flex max-w-sm flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter</span>
          <input
            aria-label="Filter prompts and agents"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.target.value || undefined })}
          />
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[14rem_1fr_18rem]">
        <aside
          aria-label="Prompts and agents"
          className="min-h-0 overflow-y-auto border-b border-[var(--oke-line)] lg:border-b-0 lg:border-r"
        >
          <section aria-label="Prompts" className="p-3">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--oke-muted)]">
              Prompts
            </h2>
            <ul className="space-y-1">
              {prompts.map((p) => (
                <li key={p.name}>
                  <button
                    type="button"
                    aria-pressed={p.name === promptName}
                    className={clsx(
                      "flex min-h-8 w-full items-center px-2 text-left text-sm",
                      p.name === promptName
                        ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
                        : "text-[var(--oke-muted)]",
                    )}
                    onClick={() => setSearch(openPromptVersion(search, p.name, p.version ?? 0))}
                  >
                    {p.name}
                    {p.version !== undefined ? (
                      <span className="ml-1 font-mono text-xs">@{p.version}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Agents" className="p-3">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--oke-muted)]">Agents</h2>
            <ul className="space-y-1">
              {agents.map((a) => (
                <li key={a.name}>
                  <button
                    type="button"
                    aria-pressed={a.name === agentName}
                    className={clsx(
                      "flex min-h-8 w-full items-center px-2 text-left text-sm",
                      a.name === agentName
                        ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
                        : "text-[var(--oke-muted)]",
                    )}
                    onClick={() =>
                      setSearch({
                        ...search,
                        agent: a.name,
                        run: undefined,
                      })
                    }
                  >
                    {a.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main id="ai-main" className="min-h-0 overflow-y-auto p-4">
          {listQuery.isLoading ? <p className="text-[var(--oke-muted)]">Loading…</p> : null}
          {listQuery.isError ? <p role="alert">Failed to load AI projection</p> : null}

          {selectedVersion ? (
            <VersionDistributions
              metrics={selectedVersion}
              versions={versions}
              onSelectVersion={(v) =>
                setSearch(openPromptVersion(search, selectedVersion.prompt, v))
              }
              catalogueHref={
                cataloguePrompt ? manifestDiffHref(cataloguePrompt.manifestDiffPath) : null
              }
              decision={decision}
            />
          ) : (
            <p className="text-[var(--oke-muted)]">No prompt versions with samples yet.</p>
          )}

          {openRun ? (
            <section aria-label="Agent run trail" className="mt-8">
              <h2 className="mb-2 text-sm font-medium">Agent run · {openRun.agent}</h2>
              <div className="mb-2 flex flex-wrap gap-2">
                {agentRuns.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={r.id === openRun.id}
                    className={clsx(
                      "min-h-8 px-2 text-xs font-mono",
                      r.id === openRun.id ? "bg-[var(--oke-line)]" : "text-[var(--oke-muted)]",
                    )}
                    onClick={() => setSearch(openAgentRun(search, r.agent, r.id))}
                  >
                    {r.id}
                  </button>
                ))}
              </div>
              <ol className="space-y-3 border-l border-[var(--oke-line)] pl-4">
                {openRun.trail.map((step, i) => (
                  <li key={`${step.tool}-${i}`} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={clsx(
                          "font-mono text-xs tracking-wide",
                          step.status === "denied"
                            ? "text-[var(--oke-fg)]"
                            : "text-[var(--oke-muted)]",
                        )}
                      >
                        {trailStatusLabel(step.status)}
                      </span>
                      <span className="font-mono">{step.tool}</span>
                    </div>
                    {step.status === "denied" && step.denial ? (
                      <p role="status" className="mt-1 text-[var(--oke-muted)]">
                        DENIED by gate{" "}
                        <span className="font-mono text-[var(--oke-fg)]">{step.denial.gate}</span>:{" "}
                        {step.denial.reason}
                      </p>
                    ) : null}
                    <ul className="mt-1 space-y-0.5 text-xs text-[var(--oke-muted)]">
                      {step.effects.map((e) => (
                        <li key={`${e.kind}:${e.resource}`}>
                          <span className="font-mono">{e.kind}</span> {e.resource}
                        </li>
                      ))}
                      {step.effects.length === 0 ? <li>no declared effects</li> : null}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section aria-label="Fallback chains" className="mt-8">
            <h2 className="mb-2 text-sm font-medium">Fallback chains</h2>
            {(data?.fallbackChains.length ?? 0) === 0 ? (
              <p className="text-sm text-[var(--oke-muted)]">No multi-model chains recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(data?.fallbackChains ?? []).map((chain, i) => (
                  <li
                    key={`${chain.prompt}-${chain.at}-${i}`}
                    className="border border-[var(--oke-line)] px-3 py-2"
                  >
                    <div className="font-mono text-xs">
                      {chain.prompt}
                      {chain.version !== undefined ? `@${chain.version}` : ""}
                    </div>
                    <div className="mt-1">
                      {chain.attempts.map((a, j) => (
                        <span key={`${a.model}-${j}`}>
                          {j > 0 ? " → " : ""}
                          <span
                            className={
                              a.ok ? "text-[var(--oke-fg)]" : "text-[var(--oke-muted)] line-through"
                            }
                          >
                            {a.model}
                          </span>
                          {a.cost !== undefined ? ` (${formatCost(a.cost)})` : ""}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-[var(--oke-muted)]">
                      actual {formatCost(chain.actualCost)}
                      {chain.costConsequence !== null
                        ? ` · cost consequence ${formatCost(chain.costConsequence)}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        <aside
          aria-label="allowPii security review"
          className="min-h-0 overflow-y-auto border-t border-[var(--oke-line)] p-4 lg:border-l lg:border-t-0"
        >
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--oke-muted)]">allowPii</h2>
          <p className="mb-3 text-xs text-[var(--oke-muted)]">
            Standing security review — flows that acknowledge PII egress to a model.
          </p>
          {pii.length === 0 ? (
            <p className="text-sm text-[var(--oke-muted)]">None declared.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">
                Standing security review — PII egress acknowledgements
              </caption>
              <thead>
                <tr className="text-[var(--oke-muted)]">
                  <th scope="col" className="pb-1 font-normal">
                    Flow
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Asks
                  </th>
                </tr>
              </thead>
              <tbody>
                {pii.map((row) => (
                  <tr key={row.flowId} className="align-top">
                    <td className="py-1 pr-2 font-mono text-[var(--oke-fg)]">{row.flowId}</td>
                    <td className="py-1 font-mono text-[var(--oke-muted)]">
                      {row.asks.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      </div>
    </div>
  );
}

function VersionDistributions(props: {
  readonly metrics: PromptVersionMetrics;
  readonly versions: readonly PromptVersionMetrics[];
  readonly onSelectVersion: (version: number) => void;
  readonly catalogueHref: string | null;
  readonly decision: ReturnType<typeof promotionDecision> | null;
}) {
  const m = props.metrics;
  return (
    <section aria-label="Version distributions" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-medium">
          {m.prompt} <span className="font-mono text-[var(--oke-muted)]">@{m.version}</span>
        </h2>
        {props.catalogueHref ? (
          <a href={props.catalogueHref} className="text-xs text-[var(--oke-muted)] underline">
            Manifest Diff — version bump is a deploy
          </a>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Versions">
        {props.versions.map((v) => (
          <button
            key={v.version}
            type="button"
            aria-pressed={v.version === m.version}
            className={clsx(
              "min-h-8 px-2 font-mono text-xs",
              v.version === m.version ? "bg-[var(--oke-line)]" : "text-[var(--oke-muted)]",
            )}
            onClick={() => props.onSelectVersion(v.version)}
          >
            v{v.version}
          </button>
        ))}
      </div>

      <DistributionBlock
        label="Cost"
        summary={distributionSummary("Cost", m.cost.mean, m.cost.p50, m.cost.p95, formatCost)}
        buckets={m.cost.buckets}
        formatTick={formatCost}
      />
      <DistributionBlock
        label="Latency"
        summary={distributionSummary(
          "Latency",
          m.latencyMs.mean,
          m.latencyMs.p50,
          m.latencyMs.p95,
          formatLatency,
        )}
        buckets={m.latencyMs.buckets}
        formatTick={formatLatency}
      />
      <DistributionBlock
        label="Eval score"
        summary={distributionSummary(
          "Eval score",
          m.evalScore.mean,
          m.evalScore.p50,
          m.evalScore.p95,
          formatEval,
        )}
        buckets={m.evalScore.buckets}
        formatTick={formatEval}
      />

      <table className="mt-4 w-full max-w-md text-left text-sm">
        <caption className="mb-2 text-left text-xs text-[var(--oke-muted)]">
          Outcome classes — schema-invalid ≠ provider-error
        </caption>
        <thead>
          <tr className="text-[var(--oke-muted)]">
            <th scope="col" className="pb-1 font-normal">
              Class
            </th>
            <th scope="col" className="pb-1 font-normal">
              Rate
            </th>
            <th scope="col" className="pb-1 font-normal">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>schema-invalid</td>
            <td>{formatRate(m.schemaInvalidRate)}</td>
            <td className="font-mono">{m.outcomeCounts.schema_invalid}</td>
          </tr>
          <tr>
            <td>provider-error</td>
            <td>{formatRate(m.providerErrorRate)}</td>
            <td className="font-mono">{m.outcomeCounts.provider_error}</td>
          </tr>
          <tr>
            <td>ok</td>
            <td>{formatRate(m.okRate)}</td>
            <td className="font-mono">{m.outcomeCounts.ok}</td>
          </tr>
        </tbody>
      </table>

      {props.decision && !props.decision.allowed ? (
        <div
          className="mt-4 border border-[var(--oke-line)] px-3 py-2"
          role="status"
          aria-label="Promotion gate"
        >
          <p className="text-sm font-medium">
            Promotion v{props.decision.from.version} → v{props.decision.to.version} blocked
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-[var(--oke-muted)]">
            {formatPromotionBlockers(props.decision).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : props.decision?.allowed ? (
        <p className="mt-4 text-sm text-[var(--oke-muted)]" role="status">
          Promotion v{props.decision.from.version} → v{props.decision.to.version} allowed
          {props.decision.evalImproved ? " (eval improved)" : ""}.
        </p>
      ) : null}
    </section>
  );
}

function DistributionBlock(props: {
  readonly label: string;
  readonly summary: string;
  readonly buckets: PromptVersionMetrics["cost"]["buckets"];
  readonly formatTick: (n: number) => string;
}) {
  const max = maxBucketCount(props.buckets);
  return (
    <div className="mb-4">
      <h3 className="text-xs uppercase tracking-wide text-[var(--oke-muted)]">
        {props.label} distribution
      </h3>
      <p className="mb-2 text-sm">{props.summary}</p>
      <div role="img" aria-label={props.summary} className="flex h-16 items-end gap-px">
        {props.buckets.map((b, i) => (
          <div
            key={i}
            title={`${props.formatTick(b.min)}–${props.formatTick(b.max)}: ${b.count}`}
            className="min-w-[4px] flex-1 bg-[var(--oke-fg)] opacity-70"
            style={{
              height: `${max === 0 ? 0 : Math.max(4, (b.count / max) * 100)}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
