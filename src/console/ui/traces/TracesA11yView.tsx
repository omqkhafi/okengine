/**
 * Static Traces markup for the axe gate — same landmarks / roles as the
 * live panel, fed by a fixture (no router / network).
 */

import { buildCausalChain, groupTraceRoots, initialFocusSpanId } from "./chain.ts";
import { criticalPathSpanIds } from "./critical-path.ts";
import { TRACES_FIXTURE } from "./fixture.ts";
import { foldTimeline, intervalsFromSpans } from "./fold.ts";
import { miniWaterfall, rootErrorCode } from "./mini.ts";
import { replayDecision } from "./replay.ts";
import { DEFAULT_SAMPLING_LABEL } from "./sampling.ts";
import { peakSpanTier } from "./tier.ts";

/** Props for {@link TracesA11yView}. */
export interface TracesA11yViewProps {
  /** Optional root id to open in detail. */
  readonly openRootId?: string;
}

/**
 * Accessible Traces list + detail for CI.
 *
 * @param props - Optional open root
 */
export function TracesA11yView(props: TracesA11yViewProps) {
  const roots = groupTraceRoots(TRACES_FIXTURE);
  const openRootId = props.openRootId ?? "run-create-ok";
  const open = roots.find((r) => r.rootId === openRootId);
  const focusId = open
    ? initialFocusSpanId(open.spans)
    : undefined;
  const chain = focusId
    ? buildCausalChain(TRACES_FIXTURE, focusId)
    : null;
  const critical = chain
    ? criticalPathSpanIds(chain.connected)
    : new Set<string>();
  const folded = chain
    ? foldTimeline(intervalsFromSpans(chain.connected), {}, critical)
    : null;
  const decision = chain ? replayDecision(chain.connected) : null;

  return (
    <div className="traces-a11y">
      <a href="#traces-main">Skip to main content</a>
      <header>
        <h1>Traces</h1>
        <p>Sampling: {DEFAULT_SAMPLING_LABEL}</p>
        <label>
          Filter by effect
          <select aria-label="Filter by effect" defaultValue="">
            <option value="">All effects</option>
            <option value="wrote:sql:bookings">Wrote sql:bookings</option>
            <option value="sent">Sent email</option>
            <option value="asked">Asked a model</option>
            <option value="secret">Read a secret</option>
            <option value="cost:0.05">Cost &gt; $0.05</option>
          </select>
        </label>
        <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
          Trace bookings.create fully for 10 minutes
        </button>
      </header>
      <main id="traces-main">
        <section aria-label="Trace list">
          <h2>Traces</h2>
          <ul>
            {roots.map((root) => {
              const err = rootErrorCode(root.spans);
              const bars = miniWaterfall(root.spans);
              return (
                <li key={root.rootId}>
                  <button
                    type="button"
                    aria-pressed={root.rootId === openRootId}
                    style={{ minHeight: 32, width: "100%" }}
                  >
                    <span>{root.root.flow}</span>
                    {err ? (
                      <span role="status" style={{ color: "#c44b4b" }}>
                        {" "}
                        {err}
                      </span>
                    ) : null}
                    <span aria-hidden="true">
                      {" "}
                      [{bars.length} bars]
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {chain && folded ? (
          <section aria-label="Trace detail" aria-live="polite">
            <h2>Causal chain</h2>
            <ol>
              {chain.parents.map((p) => (
                <li key={p.id}>
                  <button type="button" style={{ minHeight: 32 }}>
                    {p.flow}
                  </button>
                </li>
              ))}
              <li aria-current="true">
                <strong>{chain.current.flow}</strong>
                {chain.current.errorCode ? (
                  <span role="status"> {chain.current.errorCode}</span>
                ) : null}
              </li>
              {chain.children.map((c) => (
                <li key={c.id}>
                  <button type="button" style={{ minHeight: 32 }}>
                    {c.flow}
                  </button>
                </li>
              ))}
            </ol>

            <h2 id="waterfall-heading">Waterfall</h2>
            <ul
              aria-labelledby="waterfall-heading"
              style={{
                display: "flex",
                gap: 2,
                minHeight: 32,
                listStyle: "none",
                padding: 0,
                margin: 0,
              }}
            >
              {folded.segments.map((seg) => {
                if (seg.kind === "fold") {
                  return (
                    <li
                      key={seg.id}
                      style={{ flex: `${seg.displayMs} 0 0` }}
                    >
                      <button
                        type="button"
                        aria-expanded={seg.expanded}
                        style={{ minHeight: 32, minWidth: 24, width: "100%" }}
                      >
                        {seg.label}
                      </button>
                    </li>
                  );
                }
                const dim = !seg.critical;
                const external =
                  peakSpanTier(
                    chain.connected.find((s) => s.id === seg.spanId)
                      ?.effects ?? [],
                  ) === "external";
                return (
                  <li
                    key={seg.id}
                    style={{
                      minHeight: 32,
                      flex: `${seg.displayMs} 0 0`,
                      opacity: dim ? 0.38 : 1,
                      background:
                        seg.tier === "external" ? "#d97706" : "#3d9a6a",
                      outline: seg.failed ? "2px solid #c44b4b" : undefined,
                    }}
                  >
                    {seg.label}
                    {seg.critical ? " (critical path)" : ""}
                    {seg.failed ? " (failed)" : ""}
                    {external ? " ↗" : ""}
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              style={{ minHeight: 32, minWidth: 24 }}
              title={
                decision?.mode === "dry-run" ? decision.reason : undefined
              }
            >
              {decision?.mode === "dry-run" ? "Dry-run replay" : "Replay"}
            </button>
            <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
              Close
            </button>
            <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
              3 new
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
