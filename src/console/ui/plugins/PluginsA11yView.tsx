/**
 * Static Plugins markup for the axe gate — same landmarks / roles as the
 * live panel (console §9.15).
 */

import { copyCommandLabel, copyableCommand } from "./command.ts";
import { PLUGINS_LIST_FIXTURE } from "./fixture.ts";
import { groupPlugins } from "./group.ts";

/** Props for {@link PluginsA11yView}. */
export interface PluginsA11yViewProps {
  /** Plugin to open in detail. */
  readonly openPlugin?: string;
}

/**
 * Accessible Plugins list + detail for CI.
 *
 * @param props - Open plugin
 */
export function PluginsA11yView(props: PluginsA11yViewProps) {
  const list = PLUGINS_LIST_FIXTURE;
  const openId = props.openPlugin ?? "auth";
  const open = list.plugins.find((p) => p.id === openId) ?? list.plugins[0]!;
  const groups = groupPlugins(list.plugins, {});
  const command = copyableCommand(open);

  return (
    <div className="plugins-a11y">
      <a href="#plugins-main">Skip to main content</a>
      <header>
        <h1>Plugins</h1>
        <p>
          Origin × state — CORE stays listed when off; local/community only when plugged. Read-only;
          git review is the approval.
        </p>
        <label>
          Filter plugins
          <input aria-label="Filter plugins" defaultValue="" />
        </label>
        <fieldset>
          <legend>Origin</legend>
          <label>
            <input type="radio" name="origin" value="" defaultChecked /> All
          </label>
          <label>
            <input type="radio" name="origin" value="core" /> Core
          </label>
          <label>
            <input type="radio" name="origin" value="local" /> Local
          </label>
          <label>
            <input type="radio" name="origin" value="community" /> Community
          </label>
        </fieldset>
        <fieldset>
          <legend>State</legend>
          <label>
            <input type="radio" name="state" value="" defaultChecked /> All
          </label>
          <label>
            <input type="radio" name="state" value="on" /> On
          </label>
          <label>
            <input type="radio" name="state" value="off" /> Off
          </label>
        </fieldset>
      </header>
      <main id="plugins-main">
        <section aria-label="Plugins by origin">
          <h2>Catalogue</h2>
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <h3>{g.label}</h3>
              <ul>
                {g.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={p.id === open.id}
                      style={{ minHeight: 32, width: "100%" }}
                    >
                      <span>{p.id}</span>
                      <span> {p.state}</span>
                      <span> {p.origin}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        <section aria-label="Plugin detail" aria-live="polite">
          <h2>
            {open.id}{" "}
            <span>
              ({open.origin} · {open.state})
            </span>
          </h2>
          {open.summary ? <p>{open.summary}</p> : null}
          {open.version ? <p>Version {open.version}</p> : null}

          <section aria-label="Declares">
            <h3>Declares</h3>
            <p>Boot-time — schema, elements, drivers, panels, CLI</p>
            {open.declares.length === 0 ? (
              <p>None</p>
            ) : (
              <ul>
                {open.declares.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Intercepts">
            <h3>Intercepts</h3>
            <p>Per-request hooks with measured cost</p>
            {open.intercepts.length === 0 ? (
              <p>None</p>
            ) : (
              <table>
                <caption>Hook stages and measured mean cost</caption>
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Mean ms</th>
                    <th scope="col">Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {open.intercepts.map((i) => (
                    <tr key={i.stage}>
                      <th scope="row">{i.stage}</th>
                      <td>{i.meanMs === null ? "—" : i.meanMs.toFixed(2)}</td>
                      <td>{i.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {open.hookCost ? (
              <p role="status">
                p50 {open.hookCost.p50Ms.toFixed(2)} ms · p95 {open.hookCost.p95Ms.toFixed(2)} ms ·
                n={open.hookCost.count}
              </p>
            ) : null}
          </section>

          <section aria-label="Supply chain">
            <h3>Supply chain</h3>
            <ul>
              <li>
                Lifecycle scripts: {open.supplyChain.lifecycleScripts.state} —{" "}
                {open.supplyChain.lifecycleScripts.detail}
              </li>
              <li>
                Release cooldown: {open.supplyChain.releaseCooldown.state} —{" "}
                {open.supplyChain.releaseCooldown.detail}
              </li>
              <li>
                node: scan: {open.supplyChain.nodeImportScan.state} —{" "}
                {open.supplyChain.nodeImportScan.detail}
              </li>
              <li>
                npm provenance: {open.supplyChain.npmProvenance.state} —{" "}
                {open.supplyChain.npmProvenance.detail}
              </li>
              <li>
                Boot conflicts: {open.supplyChain.bootConflicts.state} —{" "}
                {open.supplyChain.bootConflicts.detail}
              </li>
            </ul>
          </section>

          <section aria-label="Capability diff">
            <h3>Capability diff</h3>
            <p>
              From git merge-base via <code>diffManifest</code> (same as{" "}
              <code>oke doctor --diff</code>)
            </p>
            {open.capabilityDiff.length === 0 ? (
              <p>No pending capability changes for this plugin</p>
            ) : (
              <ul>
                {open.capabilityDiff.map((c) => (
                  <li key={c.path}>
                    <a href={`/manifest-diff?path=${encodeURIComponent(c.path)}`}>{c.summary}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Install command">
            <h3>Command</h3>
            {command ? (
              <>
                <pre>
                  <code>{command}</code>
                </pre>
                <button type="button" style={{ minHeight: 32 }}>
                  {copyCommandLabel(open)}
                </button>
                <p>The Console never installs. Git review is the approval — run this yourself.</p>
              </>
            ) : (
              <p>No install command — toggle off by removing the code line, not from this UI.</p>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
