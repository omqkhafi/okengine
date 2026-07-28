/**
 * Static Overview markup for the axe gate — same landmarks / roles as the
 * live panel (console §9.16).
 */

import { composeOverview } from "./compose.ts";
import { OVERVIEW_DAY_ONE_INPUTS, OVERVIEW_INPUTS_FIXTURE } from "./fixture.ts";
import { formatBudgetDuration, formatBurnRate } from "./verdict.ts";

/** Props for {@link OverviewA11yView}. */
export interface OverviewA11yViewProps {
  /** Use the day-one (no SLOs) fixture. */
  readonly dayOne?: boolean;
}

/**
 * Accessible Overview for CI.
 *
 * @param props - Fixture selection
 */
export function OverviewA11yView(props: OverviewA11yViewProps = {}) {
  const view = composeOverview(props.dayOne ? OVERVIEW_DAY_ONE_INPUTS : OVERVIEW_INPUTS_FIXTURE);

  return (
    <div className="overview-a11y">
      <a href="#overview-main">Skip to main content</a>
      <header>
        <h1>Overview</h1>
        <p role="status" aria-live="polite" data-tone={view.verdict.tone}>
          {view.verdict.line}
        </p>
      </header>
      <main id="overview-main">
        {view.hasDeclaredSlos ? (
          <section aria-label="Error budgets">
            <h2>Error budgets</h2>
            <ul>
              {view.slos.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.kind}:{s.name}
                  </span>
                  <span> {s.availability}</span>
                  <span> burn {formatBurnRate(s.burnRate)}</span>
                  <span> exhausts {formatBudgetDuration(s.timeToExhaustionMs)}</span>
                  {s.ceremonial ? <span role="status"> CEREMONIAL</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Cost budgets">
          <h2>Cost budgets</h2>
          {view.costBudgets.length === 0 ? (
            <p>No cost budgets declared.</p>
          ) : (
            <ul>
              {view.costBudgets.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <span>
                    {" "}
                    ${c.spent.toFixed(2)} / ${c.declaredBudget.toFixed(2)}
                  </span>
                  <span> burn {formatBurnRate(c.burnRate)}</span>
                  <span> exhausts {formatBudgetDuration(c.timeToExhaustionMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="What changed">
          <h2>What changed</h2>
          <p>
            <a href={view.whatChanged.href}>{view.whatChanged.line}</a>
          </p>
        </section>

        <section aria-label="Findings" aria-live="polite">
          <h2>Findings</h2>
          {view.findings.length === 0 ? (
            <p>No findings from other panels.</p>
          ) : (
            <ol>
              {view.findings.map((f) => (
                <li key={f.id}>
                  <a href={f.href}>
                    {f.title}: {f.detail}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-label="Golden signals">
          <h2>Golden signals</h2>
          <dl>
            <div>
              <dt>Latency p99</dt>
              <dd>{view.golden.latencyP99Ms} ms</dd>
            </div>
            <div>
              <dt>Traffic</dt>
              <dd>{view.golden.trafficPerMin.toFixed(1)} / min</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd>{(view.golden.errorRate * 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>Saturation</dt>
              <dd>{(view.golden.saturation * 100).toFixed(1)}%</dd>
            </div>
          </dl>
        </section>

        {view.firstSloInvite ? (
          <section aria-label="Declare first SLO">
            <h2>Declare a first objective</h2>
            <p>
              Your busiest flow is{" "}
              <a href={view.firstSloInvite.href}>{view.firstSloInvite.busiestFlow}</a> (
              {view.firstSloInvite.runCount} runs). Add{" "}
              <code>slo: {'{ availability: "99.9%" }'}</code> on that flow.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
