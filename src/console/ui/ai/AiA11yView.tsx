/**
 * Static AI markup for the axe gate — same landmarks as the live panel.
 */

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
  promotionDecision,
  trailStatusLabel,
  versionsForPrompt,
  AI_LIST_FIXTURE,
} from "./index.ts";

/** Props for {@link AiA11yView}. */
export interface AiA11yViewProps {
  /** Prompt to open. */
  readonly openPrompt?: string;
  /** Version to open. */
  readonly openVersion?: number;
  /** Agent to open. */
  readonly openAgent?: string;
}

/**
 * Accessible AI panel for CI.
 *
 * @param props - Open prompt / agent
 */
export function AiA11yView(props: AiA11yViewProps) {
  const data = AI_LIST_FIXTURE;
  const promptName = props.openPrompt ?? "ticket-triage";
  const version = props.openVersion ?? 3;
  const agentName = props.openAgent ?? "support";
  const prompts = filterPrompts(data.prompts, undefined);
  const agents = filterAgents(data.agents, undefined);
  const versions = versionsForPrompt(data.versions, promptName);
  const selected = versions.find((v) => v.version === version) ?? versions[versions.length - 1];
  const baseline = versions.find((v) => v.version === 2) ?? versions[0];
  const decision =
    baseline && selected && baseline.version !== selected.version
      ? promotionDecision(baseline, selected)
      : null;
  const pii = allowPiiStanding(data.allowPii);
  const run = data.agentRuns.find((r) => r.agent === agentName);

  return (
    <div className="ai-a11y">
      <a href="#ai-main">Skip to main content</a>
      <header>
        <h1>AI</h1>
        <p>Distributions per prompt version — cost, latency, eval score</p>
        <label>
          Filter
          <input aria-label="Filter prompts and agents" defaultValue="" />
        </label>
      </header>
      <main id="ai-main">
        <section aria-label="Prompts">
          <h2>Prompts</h2>
          <ul>
            {prompts.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  aria-pressed={p.name === promptName}
                  style={{ minHeight: 32 }}
                >
                  {p.name}
                  {p.version !== undefined ? ` @${p.version}` : ""}
                </button>
                <a href={manifestDiffHref(p.manifestDiffPath)}>Manifest Diff</a>
              </li>
            ))}
          </ul>
        </section>

        {selected ? (
          <section aria-label="Version distributions" aria-live="polite">
            <h2>
              {selected.prompt} @{selected.version}
            </h2>
            <p role="status">
              {distributionSummary(
                "Cost",
                selected.cost.mean,
                selected.cost.p50,
                selected.cost.p95,
                formatCost,
              )}
            </p>
            <div
              role="img"
              aria-label={distributionSummary(
                "Cost distribution",
                selected.cost.mean,
                selected.cost.p50,
                selected.cost.p95,
                formatCost,
              )}
            >
              {selected.cost.buckets.map((b, i) => (
                <div
                  key={i}
                  style={{
                    width: `${maxBucketCount(selected.cost.buckets) === 0 ? 0 : (b.count / maxBucketCount(selected.cost.buckets)) * 100}%`,
                    minHeight: 8,
                  }}
                />
              ))}
            </div>
            <p>
              {distributionSummary(
                "Latency",
                selected.latencyMs.mean,
                selected.latencyMs.p50,
                selected.latencyMs.p95,
                formatLatency,
              )}
            </p>
            <p>
              {distributionSummary(
                "Eval score",
                selected.evalScore.mean,
                selected.evalScore.p50,
                selected.evalScore.p95,
                formatEval,
              )}
            </p>
            <table>
              <caption>Outcome classes</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Rate</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>schema-invalid</td>
                  <td>{formatRate(selected.schemaInvalidRate)}</td>
                </tr>
                <tr>
                  <td>provider-error</td>
                  <td>{formatRate(selected.providerErrorRate)}</td>
                </tr>
                <tr>
                  <td>ok</td>
                  <td>{formatRate(selected.okRate)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        ) : null}

        {decision && !decision.allowed ? (
          <section aria-label="Promotion gate" role="status">
            <h2>Promotion blocked</h2>
            <ul>
              {formatPromotionBlockers(decision).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Agents">
          <h2>Agents</h2>
          <ul>
            {agents.map((a) => (
              <li key={a.name}>
                <button type="button" aria-pressed={a.name === agentName} style={{ minHeight: 32 }}>
                  {a.name}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {run ? (
          <section aria-label="Agent run trail">
            <h2>Agent run {run.id}</h2>
            <ol>
              {run.trail.map((step, i) => (
                <li key={`${step.tool}-${i}`}>
                  <span>{trailStatusLabel(step.status)}</span> <span>{step.tool}</span>
                  {step.status === "denied" && step.denial ? (
                    <p role="status">
                      DENIED by gate {step.denial.gate}: {step.denial.reason}
                    </p>
                  ) : null}
                  <ul>
                    {step.effects.map((e) => (
                      <li key={`${e.kind}:${e.resource}`}>
                        {e.kind} {e.resource}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section aria-label="Fallback chains">
          <h2>Fallback chains</h2>
          <ul>
            {data.fallbackChains.map((chain, i) => (
              <li key={i}>
                {chain.prompt}: {chain.attempts.map((a) => a.model).join(" → ")}
                {chain.costConsequence !== null
                  ? ` · cost consequence ${formatCost(chain.costConsequence)}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="allowPii security review">
          <h2>allowPii</h2>
          <table>
            <caption>Standing security review — PII egress acknowledgements</caption>
            <thead>
              <tr>
                <th scope="col">Flow</th>
                <th scope="col">Asks</th>
                <th scope="col">allowPii</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {pii.map((row) => (
                <tr key={row.flowId}>
                  <td>{row.flowId}</td>
                  <td>{row.asks.join(", ") || "—"}</td>
                  <td>{row.allowPii ? "yes" : "no"}</td>
                  <td>{row.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
