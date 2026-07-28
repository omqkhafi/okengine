/**
 * Static Clock markup for the axe gate — same landmarks as the live panel.
 */

import { formatHealth } from "./health.ts";
import { CLOCK_LIST_FIXTURE } from "./fixture.ts";
import { formatTimelineWhen, forwardTimeline } from "./timeline.ts";
import { formatWakeIn, waitingOnBanner } from "./waiting-on.ts";

/** Props for {@link ClockA11yView}. */
export interface ClockA11yViewProps {
  /** Optional cron name to open. */
  readonly openCron?: string;
  /** Optional wake run id to open. */
  readonly openWake?: string;
}

/**
 * Accessible Clock timeline + waiting-on + cron detail for CI.
 *
 * @param props - Open cron / wake
 */
export function ClockA11yView(props: ClockA11yViewProps) {
  const data = CLOCK_LIST_FIXTURE;
  const timeline = forwardTimeline(data.timeline, data.now);
  const openCronName = props.openCron ?? "nightly";
  const openCron = data.crons.find((c) => c.name === openCronName);
  const openWakeId = props.openWake ?? "run_sleep_1";
  const openWake = data.waitingOn.find((w) => w.runId === openWakeId);
  const health = openCron ? formatHealth(openCron.health) : null;
  const banner = waitingOnBanner(data.waitingOn.length, data.waitingOnCounts);

  return (
    <div className="clock-a11y">
      <a href="#clock-main">Skip to main content</a>
      <header>
        <h1>Clock</h1>
        <p>Forward timeline, waiting-on, cron health</p>
        <label>
          Filter clock
          <input aria-label="Filter clock" defaultValue="" />
        </label>
      </header>
      <main id="clock-main">
        <section aria-label="Forward timeline">
          <h2>Next 24 hours</h2>
          <ol>
            {timeline.map((e) => (
              <li key={`${e.kind}-${e.name}-${e.at}`}>
                <span>{formatTimelineWhen(e.at, data.now)}</span>
                <span>
                  {" "}
                  {e.kind === "cron" ? "cron" : "wake"} {e.name}
                </span>
                {e.meta ? <span> ({e.meta})</span> : null}
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Waiting on">
          <h2>Waiting on</h2>
          <p role="status">{banner}</p>
          <ul>
            {data.waitingOn.map((w) => (
              <li key={w.runId}>
                <button
                  type="button"
                  aria-pressed={w.runId === openWakeId}
                  style={{ minHeight: 32, width: "100%" }}
                >
                  <span>{w.label || w.flow}</span>
                  <span> wake-in {formatWakeIn(w.wakeInMs)}</span>
                  {w.step ? <span> step {w.step}</span> : null}
                  <span>
                    {" "}
                    runs{" "}
                    {data.waitingOnCounts.find((c) => c.label === (w.label || "(unlabelled)"))
                      ?.count ?? 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Cron schedules">
          <h2>Schedules</h2>
          <ul>
            {data.crons.map((c) => {
              const h = formatHealth(c.health);
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    aria-pressed={c.name === openCronName}
                    style={{ minHeight: 32, width: "100%" }}
                  >
                    <span>{c.name}</span>
                    {c.health.overdue ? <span role="status"> overdue</span> : null}
                    {c.dstAmbiguity ? <span role="status"> DST {c.dstAmbiguity.kind}</span> : null}
                    {c.external ? <span aria-label="external effect"> ↗</span> : null}
                  </button>
                  <p role="status">
                    {h.drift} · {h.overdue} · {h.missedWithPolicy} · {h.lease}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {openCron && health ? (
          <section aria-label="Cron detail" aria-live="polite">
            <h2>{openCron.name}</h2>
            <p role="status">
              {openCron.effectiveCron ?? openCron.effectiveEvery} · {openCron.timezone}
            </p>
            <dl>
              <div>
                <dt>Drift</dt>
                <dd>{health.drift}</dd>
              </div>
              <div>
                <dt>Overdue</dt>
                <dd>{health.overdue}</dd>
              </div>
              <div>
                <dt>Missed + catch-up</dt>
                <dd>{health.missedWithPolicy}</dd>
              </div>
              <div>
                <dt>Lease</dt>
                <dd>{health.lease}</dd>
              </div>
            </dl>
            {openCron.dstAmbiguity ? <p role="alert">{openCron.dstAmbiguity.reason}</p> : null}
            <div>
              <button type="button">Run now</button>
              <button type="button">Pause</button>
              {openCron.overridable ? <button type="button">Edit schedule</button> : null}
            </div>
            {openCron.external ? (
              <label>
                Type RUN to confirm
                <input aria-label="Type RUN to confirm" defaultValue="" />
              </label>
            ) : null}
          </section>
        ) : null}

        {openWake ? (
          <section aria-label="Wake detail" aria-live="polite">
            <h2>{openWake.label || openWake.flow}</h2>
            <p role="status">
              Wake in {formatWakeIn(openWake.wakeInMs)}
              {openWake.step ? ` · step ${openWake.step}` : ""}
            </p>
            <button type="button">Wake early</button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
