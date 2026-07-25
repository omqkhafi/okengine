/**
 * Static Manifest Diff markup for the axe gate — same landmarks as the live panel.
 */

import { formatCiGate, groupByCategory } from "./group.ts";
import { DIFF_LIST_FIXTURE } from "./fixture.ts";

/** Props for {@link DiffA11yView}. */
export interface DiffA11yViewProps {
  /** Focused Manifest path. */
  readonly path?: string;
}

/**
 * Accessible Manifest Diff list for CI.
 *
 * @param props - Open selection
 */
export function DiffA11yView(props: DiffA11yViewProps) {
  const data = DIFF_LIST_FIXTURE;
  const groups = groupByCategory(data.changes);
  const focusPath = props.path ?? data.changes[3]?.path;

  return (
    <div className="diff-a11y">
      <a href="#diff-main">Skip to main content</a>
      <header>
        <h1>Manifest Diff</h1>
        <p>
          Blast radius of a deploy — contract, permission, effect, and no-impact
          changes. Read-only compare of current Manifest vs baseline.
        </p>
        <label>
          Filter changes
          <input aria-label="Filter changes" defaultValue="" />
        </label>
      </header>

      <section aria-label="CI gate summary" role="status">
        <h2>CI gate</h2>
        <p>
          {data.blockedCount} undeclared break
          {data.blockedCount === 1 ? "" : "s"} blocked ·{" "}
          {data.acknowledgedCount} acknowledged with breaking: true
        </p>
      </section>

      <main id="diff-main">
        {groups.map((group) => (
          <section
            key={group.category}
            aria-label={group.label}
          >
            <h2>{group.label}</h2>
            <ul>
              {group.items.map((item) => {
                const gate = formatCiGate(item.ciGate);
                const selected = item.path === focusPath;
                return (
                  <li key={item.path}>
                    <article
                      aria-current={selected ? "true" : undefined}
                    >
                      <h3>
                        <code>{item.path}</code>
                      </h3>
                      <p>{item.summary}</p>
                      {item.blastLine ? (
                        <p role="status">{item.blastLine}</p>
                      ) : null}
                      {item.weeklyBillLine ? (
                        <p>Weekly bill: {item.weeklyBillLine}</p>
                      ) : null}
                      {gate ? <p role="status">{gate}</p> : null}
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
