/**
 * Static Signals markup for the axe gate — same landmarks / roles as the
 * live panel, fed by a fixture (no router / network).
 */

import { durableLine } from "./durable.ts";
import { SIGNALS_FIXTURE } from "./fixture.ts";
import { groupByPhysics } from "./group.ts";
import { fieldsFromSchema, payloadToFormValues } from "./schema-form.ts";

/** Props for {@link SignalsA11yView}. */
export interface SignalsA11yViewProps {
  /** Optional signal name to open in detail. */
  readonly openSignal?: string;
  /** Optional dead-letter id to open. */
  readonly openDlq?: string;
}

/**
 * Accessible Signals list + detail for CI.
 *
 * @param props - Optional open signal / DLQ
 */
export function SignalsA11yView(props: SignalsA11yViewProps) {
  const groups = groupByPhysics(SIGNALS_FIXTURE);
  const openName = props.openSignal ?? "order-placed";
  const open = SIGNALS_FIXTURE.find((s) => s.name === openName);
  const line = open ? durableLine(open.consumersDurable) : null;
  const dlqId = props.openDlq ?? "dlq-1";
  const dlq = open?.deadLetters.find((d) => d.id === dlqId);
  const fields = open ? fieldsFromSchema(open.schema) : [];
  const formValues = dlq ? payloadToFormValues(dlq.payload, fields) : {};

  return (
    <div className="signals-a11y">
      <a href="#signals-main">Skip to main content</a>
      <header>
        <h1>Signals</h1>
        <p>One list, grouped by delivery physics</p>
        <label>
          Filter signals
          <input aria-label="Filter signals" defaultValue="" />
        </label>
      </header>
      <main id="signals-main">
        <section aria-label="Signal list">
          <h2>Signals</h2>
          {groups.map((group) => (
            <section key={group.delivery} aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.signals.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      aria-pressed={s.name === openName}
                      style={{ minHeight: 32, width: "100%" }}
                    >
                      <span>{s.name}</span>
                      {s.orphaned ? <span role="status"> orphaned</span> : null}
                      {s.dead > 0 ? <span role="status"> DLQ {s.dead}</span> : null}
                      {s.outboxLagMs !== null && s.outboxLagMs > 0 ? (
                        <span> outbox {s.outboxLagMs}ms</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {open && line ? (
          <section aria-label="Signal detail" aria-live="polite">
            <h2>{open.name}</h2>
            <p role="status" data-durable={String(line.durable)}>
              {line.statement}
            </p>

            {open.delivery === "once" ? (
              <dl>
                <dt>Pending</dt>
                <dd>{open.pending}</dd>
                <dt>In-flight</dt>
                <dd>{open.inflight}</dd>
                <dt>DLQ</dt>
                <dd>{open.dead}</dd>
                <dt>Retry policy</dt>
                <dd>{open.retries} retries</dd>
              </dl>
            ) : null}

            {open.delivery === "broadcast" ? (
              <table>
                <caption>Subscribers</caption>
                <thead>
                  <tr>
                    <th scope="col">Subscriber</th>
                    <th scope="col">Lag</th>
                    <th scope="col">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {open.subscribers.map((sub) => (
                    <tr key={sub.id}>
                      <td>{sub.id}</td>
                      <td>{sub.lag}</td>
                      <td>{sub.errorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {open.delivery === "live" ? (
              <section aria-label="Payload monitor">
                <h3>Payload monitor</h3>
                <p>
                  {open.connections} connections · {open.throughputPerSec}/s
                </p>
                <button type="button" style={{ minHeight: 32 }}>
                  Pause
                </button>
                <button type="button" style={{ minHeight: 32 }}>
                  Export
                </button>
                <ul>
                  {open.recentLive.map((p, i) => (
                    <li key={i}>
                      <code>{JSON.stringify(p)}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-label="Producers and consumers">
              <h3>Causality</h3>
              <ul>
                {open.producers.map((p) => (
                  <li key={`p-${p.flowId}`}>
                    <a href={`/flows?sel=flow&flow=${encodeURIComponent(p.flowId)}`}>
                      Producer {p.flowId}
                    </a>
                  </li>
                ))}
                {open.consumers.map((c) => (
                  <li key={`c-${c.flowId}`}>
                    <a href={`/flows?sel=flow&flow=${encodeURIComponent(c.flowId)}`}>
                      Consumer {c.flowId}
                      {c.durable ? " (durable)" : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            {open.dead > 0 ? (
              <section aria-label="Dead letters">
                <h3>Dead letters</h3>
                <p>Bulk repair: dry run first, then replay at a controlled rate.</p>
                <label>
                  Replay rate (per second)
                  <input
                    aria-label="Replay rate (per second)"
                    type="number"
                    defaultValue={10}
                    min={1}
                    max={1000}
                  />
                </label>
                <button type="button" style={{ minHeight: 32 }}>
                  Dry run
                </button>
                <button type="button" style={{ minHeight: 32 }}>
                  Replay
                </button>
                <ul>
                  {open.deadLetters.map((d) => (
                    <li key={d.id}>
                      <button type="button" aria-pressed={d.id === dlqId} style={{ minHeight: 32 }}>
                        {d.id} · {d.failures[d.failures.length - 1]?.code}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {dlq ? (
              <section aria-label="Dead-letter detail">
                <h3>Dead letter {dlq.id}</h3>
                <p role="status">{line.statement}</p>
                <form aria-label="Editable payload">
                  {fields.length > 0 ? (
                    fields.map((f) => (
                      <label key={f.key}>
                        {f.key}
                        {f.enumValues ? (
                          <select aria-label={f.key} defaultValue={formValues[f.key] ?? ""}>
                            {f.enumValues.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input aria-label={f.key} defaultValue={formValues[f.key] ?? ""} />
                        )}
                      </label>
                    ))
                  ) : (
                    <label>
                      Payload JSON
                      <textarea
                        aria-label="Payload JSON"
                        defaultValue={formValues._raw ?? ""}
                        rows={4}
                      />
                    </label>
                  )}
                </form>
                <h4>Attempt history</h4>
                <ol>
                  {dlq.failures.map((f) => (
                    <li key={`${f.attempt}-${f.code}`}>
                      Attempt {f.attempt}: {f.code} — {f.message}
                    </li>
                  ))}
                </ol>
                {dlq.causeRunId ? (
                  <p>
                    Causal chain:{" "}
                    <a href={`/traces?trace=${encodeURIComponent(dlq.causeRunId)}`}>
                      {dlq.causeFlow ?? dlq.causeRunId}
                    </a>
                  </p>
                ) : null}
                <button type="button" style={{ minHeight: 32 }}>
                  Replay this message
                </button>
                <button type="button" style={{ minHeight: 32 }}>
                  Discard
                </button>
              </section>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
