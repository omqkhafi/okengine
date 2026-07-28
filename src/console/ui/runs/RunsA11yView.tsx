/**
 * Static Runs markup for the axe gate — same landmarks / roles as the
 * live panel, fed by fixtures (no router / network).
 */

import { explainDurationOutliers } from "./explain.ts";
import { RUNS_CHAIN_FIXTURE, runsOutlierFixture } from "./fixture.ts";
import { groupByDimension } from "./group.ts";
import { durationHistogram, formatDurationMs } from "./histogram.ts";
import { filterRuns, parseDimensionQuery } from "./query.ts";
import { shouldOfferTracesLink, tracesHrefForRun } from "./trace-link.ts";

/** Props for {@link RunsA11yView}. */
export interface RunsA11yViewProps {
  /** Optional run id to open in detail. */
  readonly openRunId?: string;
  /** Include the outlier population fixture (heavier). */
  readonly withOutliers?: boolean;
}

/**
 * Accessible Runs analysis view for CI.
 *
 * @param props - Optional open run + outlier fixture flag
 */
export function RunsA11yView(props: RunsA11yViewProps) {
  const population = props.withOutliers
    ? [...RUNS_CHAIN_FIXTURE, ...runsOutlierFixture().slice(0, 80)]
    : RUNS_CHAIN_FIXTURE;
  const query = parseDimensionQuery("");
  const filtered = filterRuns(population, query);
  const buckets = durationHistogram(filtered, 10);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));
  const range = { minMs: 1000, maxMs: 10_000 };
  const findings = explainDurationOutliers(filtered, range);
  const groups = groupByDimension(filtered, "cache");
  const openId = props.openRunId ?? "run-create-ok";
  const open = population.find((r) => r.id === openId);

  return (
    <div className="runs-a11y">
      <a href="#runs-main">Skip to main content</a>
      <header>
        <h1>Runs</h1>
        <p>Population analysis</p>
        <label>
          Query dimension
          <select aria-label="Query dimension" defaultValue="cache">
            <option value="cache">cache</option>
            <option value="flow">flow</option>
            <option value="tenant">tenant</option>
          </select>
        </label>
        <label>
          Query operator
          <select aria-label="Query operator" defaultValue="=">
            <option value="=">=</option>
            <option value="!=">!=</option>
          </select>
        </label>
        <label>
          Query value
          <input aria-label="Query value" defaultValue="miss" />
        </label>
        <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
          Add
        </button>
        <label>
          Dimension query expression
          <input
            aria-label="Dimension query expression"
            defaultValue="cache = miss"
            placeholder="flow = X AND cache = miss AND duration > 1s"
          />
        </label>
        <label>
          Group by
          <select aria-label="Group by dimension" defaultValue="cache">
            <option value="">None</option>
            <option value="cache">cache</option>
            <option value="tenant">tenant</option>
          </select>
        </label>
      </header>

      <main id="runs-main">
        <section aria-label="Duration distribution">
          <h2>Duration distribution</h2>
          <div
            role="group"
            aria-label="Duration histogram"
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 1,
              height: 120,
            }}
          >
            {buckets.map((b, i) => {
              const selected = b.minMs <= range.maxMs && b.maxMs >= range.minMs;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Duration ${formatDurationMs(b.minMs)} to ${formatDurationMs(b.maxMs)}, ${b.count} runs`}
                  style={{
                    minHeight: 32,
                    minWidth: 24,
                    flex: 1,
                    height: `${Math.max(8, (b.count / maxBucket) * 100)}%`,
                    background: selected ? "#3d9a6a" : "#666",
                  }}
                />
              );
            })}
          </div>
          <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
            Clear selection
          </button>
        </section>

        <section aria-label="Outlier explanation">
          <h2>Outlier explanation</h2>
          <ol>
            {findings.slice(0, 5).map((f) => (
              <li key={`${f.dimension}:${f.value}`}>{f.explanation}</li>
            ))}
          </ol>
        </section>

        <section aria-label="Group aggregates">
          <h2>Group by cache</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">cache</th>
                <th scope="col">Count</th>
                <th scope="col">Avg</th>
                <th scope="col">p50</th>
                <th scope="col">p99</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.key}</td>
                  <td>{g.count}</td>
                  <td>{formatDurationMs(g.avgDurationMs)}</td>
                  <td>{formatDurationMs(g.p50DurationMs)}</td>
                  <td>{formatDurationMs(g.p99DurationMs)}</td>
                  <td>{g.sumCost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-label="Run list">
          <h2>Runs</h2>
          <ul>
            {RUNS_CHAIN_FIXTURE.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  aria-pressed={run.id === openId}
                  style={{ minHeight: 32, width: "100%" }}
                >
                  {run.flow}{" "}
                  {run.error ? (
                    <span role="status">{run.error}</span>
                  ) : (
                    formatDurationMs(run.durationMs)
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {open ? (
          <section aria-label="Run detail" aria-live="polite">
            <h2>{open.flow}</h2>
            <dl>
              <div>
                <dt>flow</dt>
                <dd>{open.flow}</dd>
              </div>
              <div>
                <dt>unit</dt>
                <dd>{open.unit ?? "—"}</dd>
              </div>
              <div>
                <dt>trigger</dt>
                <dd>{open.trigger}</dd>
              </div>
              <div>
                <dt>plane</dt>
                <dd>{open.plane}</dd>
              </div>
              <div>
                <dt>tenant</dt>
                <dd>{open.tenant ?? "—"}</dd>
              </div>
              <div>
                <dt>principal</dt>
                <dd>{open.principal ?? "—"}</dd>
              </div>
              <div>
                <dt>gates</dt>
                <dd>{open.gates.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt>cache</dt>
                <dd>{open.cache}</dd>
              </div>
              <div>
                <dt>error</dt>
                <dd>{open.error ? <span role="status">{open.error}</span> : "—"}</dd>
              </div>
            </dl>
            <h3>Effects</h3>
            <ul>
              {open.effects.map((e, i) => (
                <li key={i}>
                  {e.kind} {e.resource}
                </li>
              ))}
            </ul>
            <details open>
              <summary>fx.log ({open.logs.length})</summary>
              <ul>
                {open.logs.map((line, i) => (
                  <li key={i}>
                    [{line.level}] {line.message}
                  </li>
                ))}
              </ul>
            </details>
            {shouldOfferTracesLink(population, open.id) ? (
              <a href={tracesHrefForRun(population, open.id)}>Open in Traces</a>
            ) : null}
            <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
              Close
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
