/**
 * Static causality markup for the axe gate — same landmarks / roles as the
 * live panel, fed by a Manifest fixture (no router / network).
 */

import {
  buildCausalityGraph,
  centreFlows,
  leftCauses,
  rightEffects,
} from "./graph.ts";
import type { Manifest } from "../../../manifest/types.ts";
import { TIER_LABEL, TIER_ORDER } from "./tiers.ts";

/** Props for {@link FlowsA11yView}. */
export interface FlowsA11yViewProps {
  readonly manifest: Manifest;
  readonly effect?: string;
}

/**
 * Accessible three-column causality view for CI.
 *
 * @param props - Manifest + optional effect selection
 */
export function FlowsA11yView(props: FlowsA11yViewProps) {
  const graph = buildCausalityGraph(props.manifest);
  const selection = props.effect
    ? ({ sel: "effect" as const, effect: props.effect })
    : ({ sel: "none" as const });
  const causes = leftCauses(graph, selection);
  const flows = centreFlows(graph, selection);
  const effects = rightEffects(graph, selection);

  return (
    <div className="flows-a11y">
      <a href="#flows-main">Skip to main content</a>
      <header>
        <h1>Flows</h1>
        <p>Causes ← Flows → Effects</p>
        <label>
          Filter
          <input type="search" aria-label="Filter flows" />
        </label>
      </header>
      <main id="flows-main">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr 1fr",
            gap: "0.5rem",
          }}
        >
          <section aria-label="Causes">
            <h2>Causes</h2>
            <ul>
              {causes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={false}
                    style={{
                      minHeight: 32,
                      minWidth: 24,
                      opacity: c.match ? 1 : 0.38,
                    }}
                  >
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Flows">
            <h2>Flows</h2>
            <ul>
              {flows.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    aria-pressed={false}
                    style={{
                      minHeight: 32,
                      width: "100%",
                      opacity: f.match ? 1 : 0.38,
                    }}
                  >
                    {f.id}
                    {f.external ? (
                      <span aria-label="external effect"> ↗</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Effects">
            <h2>Effects</h2>
            {TIER_ORDER.map((tier) => {
              const rows = effects.filter((e) => e.tier === tier);
              if (rows.length === 0) return null;
              return (
                <div key={tier}>
                  <h3>{TIER_LABEL[tier]}</h3>
                  <ul>
                    {rows.map((e) => (
                      <li key={e.ref}>
                        <button
                          type="button"
                          aria-pressed={props.effect === e.ref}
                          style={{
                            minHeight: 32,
                            minWidth: 24,
                            opacity: e.match ? 1 : 0.38,
                            color:
                              tier === "external" ? "#d97706" : undefined,
                          }}
                        >
                          {e.ref}
                          {tier === "external" ? (
                            <span aria-hidden="true"> ↗</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        </div>
      </main>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        hidden={!props.effect}
      >
        <h2 id="drawer-title">Flow workshop</h2>
        <label>
          As whom
          <select aria-label="Identity">
            <option>Demo User</option>
          </select>
        </label>
        <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
          Invoke
        </button>
        <button type="button" style={{ minHeight: 32, minWidth: 24 }}>
          Close
        </button>
      </aside>
    </div>
  );
}
