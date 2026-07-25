/**
 * Static Architecture markup for the axe gate — same landmarks / roles as
 * the live panel (console §9.13). View-only: no preview, no destructive actions.
 */

import { buildCausalityGraph } from "../flows/graph.ts";
import {
  ARCHITECTURE_RUNS_FIXTURE,
  ARCHITECTURE_TEST_MANIFEST,
} from "./fixture.ts";
import { LAYER_LABEL, ELEMENT_LAYERS } from "./types.ts";
import { buildArchitectureView } from "./view.ts";
import { layersOf, type ArchitectureSearch } from "./search.ts";

/** Props for {@link ArchitectureA11yView}. */
export interface ArchitectureA11yViewProps {
  /** Optional focus node id. */
  readonly focus?: string;
  /** Neighbourhood depth. */
  readonly depth?: 1 | 2;
}

/**
 * Accessible Architecture panel for CI.
 *
 * @param props - Focus + depth
 */
export function ArchitectureA11yView(props: ArchitectureA11yViewProps) {
  const search: ArchitectureSearch = {
    focus: props.focus,
    depth: props.depth ?? 1,
  };
  const graph = buildCausalityGraph(ARCHITECTURE_TEST_MANIFEST);
  const view = buildArchitectureView(graph, {
    focus: search.focus ?? null,
    depth: search.depth,
    layers: layersOf(search),
    runs: ARCHITECTURE_RUNS_FIXTURE,
  });

  return (
    <div className="architecture-a11y">
      <a href="#architecture-main">Skip to main content</a>
      <header>
        <h1>Architecture</h1>
        <p>What shape — clustered by unit, typed layers, live traffic</p>
        <p role="status">
          Boundary crossings: {view.boundaryCrossingCount}
        </p>
      </header>

      <main id="architecture-main">
        <fieldset>
          <legend>Element layers</legend>
          {ELEMENT_LAYERS.map((layer) => (
            <label key={layer}>
              <input
                type="checkbox"
                checked={view.layers[layer]}
                onChange={() => {}}
                aria-label={`${LAYER_LABEL[layer]} layer`}
              />{" "}
              {LAYER_LABEL[layer]}
            </label>
          ))}
        </fieldset>

        {view.focus ? (
          <div>
            <p>
              Focus: {view.focus} · depth {view.depth}
            </p>
            <button type="button">Clear focus</button>
            <fieldset>
              <legend>Focus depth</legend>
              <label>
                <input
                  type="radio"
                  name="depth"
                  checked={view.depth === 1}
                  onChange={() => {}}
                />{" "}
                1 hop
              </label>
              <label>
                <input
                  type="radio"
                  name="depth"
                  checked={view.depth === 2}
                  onChange={() => {}}
                />{" "}
                2 hops
              </label>
            </fieldset>
          </div>
        ) : null}

        <section aria-label="System diagram">
          <h2>System</h2>
          <div aria-hidden="true">
            <svg width="640" height="360" viewBox="0 0 640 360">
              <rect
                x="24"
                y="24"
                width="420"
                height="312"
                fill="none"
                stroke="currentColor"
                strokeDasharray="6 4"
              />
              <text x="32" y="44" fontSize="12" fill="currentColor">
                System boundary
              </text>
            </svg>
          </div>
          <ul aria-label="Nodes">
            {view.nodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  aria-pressed={n.focused === true}
                  style={{ minHeight: 32 }}
                >
                  {n.label}
                  {n.kind === "unit" && n.flowCount !== undefined
                    ? ` (${n.flowCount} flows)`
                    : ""}
                  {!n.insideBoundary ? " — outside boundary" : ""}
                </button>
              </li>
            ))}
          </ul>
          <ul aria-label="Edges">
            {view.edges.map((e) => (
              <li key={e.id}>
                {e.from} → {e.to}
                {e.dashed ? " (declared, never traversed)" : ` · ${e.traversals} traversals`}
                {` · ${e.layer}`}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Findings" aria-live="polite">
          <h2>Findings</h2>
          {view.findings.length === 0 ? (
            <p>No pathologies detected.</p>
          ) : (
            <ul>
              {view.findings.map((f, i) => (
                <li key={`${f.kind}-${i}`}>
                  <strong>{f.title}</strong>
                  {" — "}
                  {f.detail}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
