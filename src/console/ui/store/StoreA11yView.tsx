/**
 * Static Store markup for the axe gate — same landmarks as the live panel.
 */

import { explainCache } from "./cache-view.ts";
import { STORE_LIST_FIXTURE } from "./fixture.ts";
import { groupByFacet } from "./group.ts";
import { formatWillNotFire } from "./will-not-fire.ts";

/** Props for {@link StoreA11yView}. */
export interface StoreA11yViewProps {
  /** Optional store ref to open. */
  readonly openRef?: string;
  /** Optional child name. */
  readonly openChild?: string;
  /** Whether tenancy is declared (header selector). */
  readonly tenancyDeclared?: boolean;
}

/**
 * Accessible Store list + detail for CI.
 *
 * @param props - Open store / child
 */
export function StoreA11yView(props: StoreA11yViewProps) {
  const tenancy = props.tenancyDeclared ?? STORE_LIST_FIXTURE.tenancyDeclared;
  const groups = groupByFacet(STORE_LIST_FIXTURE.stores);
  const openRef = props.openRef ?? "sql:db";
  const open = STORE_LIST_FIXTURE.stores.find((s) => s.ref === openRef);
  const childName = props.openChild ?? "bookings";
  const child = open?.children.find((c) => c.name === childName);
  const willNot = child ? formatWillNotFire(child.willNotFire) : null;
  const cache = child ? explainCache(child) : null;

  return (
    <div className="store-a11y">
      <a href="#store-main">Skip to main content</a>
      <header>
        <h1>Store</h1>
        <p>One list, grouped by facet</p>
        {tenancy ? (
          <label>
            Tenant
            <select aria-label="Tenant" defaultValue="tenant_a">
              {STORE_LIST_FIXTURE.tenants.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Filter stores
          <input aria-label="Filter stores" defaultValue="" />
        </label>
      </header>
      <main id="store-main">
        <section aria-label="Store list">
          <h2>Stores</h2>
          {groups.map((group) => (
            <section key={group.facet} aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.stores.map((s) => (
                  <li key={s.ref}>
                    <button
                      type="button"
                      aria-pressed={s.ref === openRef}
                      style={{ minHeight: 32, width: "100%" }}
                    >
                      <span>{s.name}</span>
                      {s.replicaLagMs != null && s.replicaLagMs > 0 ? (
                        <span role="status"> lag {s.replicaLagMs}ms</span>
                      ) : null}
                      {s.migrationDrift?.drifted ? <span role="status"> drift</span> : null}
                      {s.warnings.length > 0 ? (
                        <span role="status"> {s.warnings.length} warning(s)</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {open && child ? (
          <section aria-label="Store detail" aria-live="polite">
            <h2>
              {open.name} / {child.name}
            </h2>
            <p role="status">
              Writers: {child.writers.join(", ") || "none"} · Readers:{" "}
              {child.readers.join(", ") || "none"}
            </p>

            {open.facet === "sql" ? (
              <>
                <h3>Table browser</h3>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">id</th>
                      <th scope="col">email</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>b1</td>
                      <td>[redacted]</td>
                    </tr>
                  </tbody>
                </table>
                <label>
                  SQL (read-only)
                  <textarea
                    aria-label="SQL console"
                    defaultValue='SELECT * FROM "bookings" LIMIT 50'
                    rows={3}
                  />
                </label>
              </>
            ) : null}

            {open.facet === "kv" ? (
              <>
                <h3>Key browser</h3>
                <ul aria-label="Keys">
                  <li>session:abc</li>
                </ul>
              </>
            ) : null}

            {open.facet === "files" ? (
              <>
                <h3>Bucket browser</h3>
                <ul aria-label="Objects">
                  {open.warnings.map((w) => (
                    <li key={w.key}>
                      {w.key}
                      <span role="status"> {w.message}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {open.facet === "index" ? (
              <>
                <h3>Similarity probe</h3>
                <label>
                  Vector
                  <input aria-label="Probe vector" defaultValue="0.1,0.2,0.3" />
                </label>
              </>
            ) : null}

            {cache ? (
              <section aria-label="Cache">
                <h3>Cache</h3>
                <p role="status">{cache.summary}</p>
              </section>
            ) : null}

            {willNot && !willNot.empty ? (
              <section aria-label="Edit confirmation">
                <h3>Before saving a direct edit</h3>
                <p>{willNot.headline}</p>
                <ul>
                  {willNot.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <label>
                  Type EDIT
                  <input aria-label="Confirmation phrase" />
                </label>
                <label>
                  Reason
                  <input aria-label="Confirmation reason" />
                </label>
                <button type="button" style={{ minHeight: 32 }}>
                  Save edit
                </button>
              </section>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
