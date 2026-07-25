/**
 * Static Gates markup for the axe gate — same landmarks as the live panel.
 */

import { auditLines, formatViolation } from "./audit.ts";
import { formatDenial, formatEvaluationStep } from "./denial.ts";
import {
  GATES_LIST_FIXTURE,
  SIMULATE_RATE_FIXTURE,
} from "./fixture.ts";
import { groupFlows, groupPrincipals } from "./group.ts";

/** Props for {@link GatesA11yView}. */
export interface GatesA11yViewProps {
  /** Inquiry direction. */
  readonly from?: "principal" | "flow";
  /** Open principal encoded id. */
  readonly openPrincipal?: string;
  /** Open flow id. */
  readonly openFlow?: string;
}

/**
 * Accessible Gates list + simulator for CI.
 *
 * @param props - Open selection
 */
export function GatesA11yView(props: GatesA11yViewProps) {
  const from = props.from ?? "flow";
  const groups =
    from === "principal"
      ? groupPrincipals(GATES_LIST_FIXTURE.principals)
      : groupFlows(GATES_LIST_FIXTURE.flows);
  const openFlowId = props.openFlow ?? "bookings.create";
  const openFlow = GATES_LIST_FIXTURE.flows.find(
    (f) => f.flowId === openFlowId,
  );
  const openPrincipalId = props.openPrincipal ?? "role:role_member";
  const openPrincipal = GATES_LIST_FIXTURE.principals.find(
    (p) => `${p.kind}:${p.id}` === openPrincipalId,
  );
  const lines = auditLines(GATES_LIST_FIXTURE.audit);
  const sim = SIMULATE_RATE_FIXTURE;

  return (
    <div className="gates-a11y">
      <a href="#gates-main">Skip to main content</a>
      <header>
        <h1>Gates</h1>
        <p>Two inquiries — principal or flow — simulator at the centre</p>
        <div role="group" aria-label="Inquiry direction">
          <button type="button" aria-pressed={from === "principal"}>
            From principal
          </button>
          <button type="button" aria-pressed={from === "flow"}>
            From flow
          </button>
        </div>
        <label>
          Filter gates
          <input aria-label="Filter gates" defaultValue="" />
        </label>
      </header>

      {lines.length > 0 ? (
        <section aria-label="Continuous security audit" role="status">
          <h2>Standing audit</h2>
          <ul>
            {lines.map((line) => (
              <li key={line.code}>{line.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {GATES_LIST_FIXTURE.violations.length > 0 ? (
        <section aria-label="Plane violations" role="alert">
          <h2>Two-plane violations</h2>
          <ul>
            {GATES_LIST_FIXTURE.violations.map((v) => (
              <li key={v.operatorId}>{formatViolation(v)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <main id="gates-main">
        <section aria-label={from === "principal" ? "Principal list" : "Flow list"}>
          <h2>{from === "principal" ? "Principals" : "Flows"}</h2>
          {groups.map((group) => (
            <section key={group.id} aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={
                        from === "flow"
                          ? item.id === openFlowId
                          : item.id === openPrincipalId
                      }
                      style={{ minHeight: 32, width: "100%" }}
                    >
                      <span>{item.label}</span>
                      {item.meta ? <span> {item.meta}</span> : null}
                      {item.flag ? (
                        <span role="status"> {item.flag}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        <section aria-label="Gates detail" aria-live="polite">
          {from === "flow" && openFlow ? (
            <>
              <h2>{openFlow.flowId}</h2>
              <p>Gate chain in registration order</p>
              <ol aria-label="Gate chain">
                {openFlow.gates.map((g) => (
                  <li key={g}>
                    <code>{g}</code>
                  </li>
                ))}
              </ol>
              {openFlow.unguarded ? (
                <p role="status">Unguarded — public on the user plane</p>
              ) : null}
            </>
          ) : null}

          {from === "principal" && openPrincipal ? (
            <>
              <h2>{openPrincipal.name}</h2>
              <p>
                {openPrincipal.kind} · {openPrincipal.plane} plane
              </p>
              <h3>Scopes</h3>
              <ul aria-label="Scopes">
                {openPrincipal.scopes.map((s) => (
                  <li key={s}>
                    <code>{s}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <section aria-label="Simulator">
            <h3>Simulator</h3>
            <p>Evaluates the gate chain only — never runs the handler</p>
            <label>
              Companion selection
              <select aria-label="Companion selection" defaultValue="user_demo">
                <option value="user_demo">Demo User</option>
                <option value="role_member">member role</option>
              </select>
            </label>
            <button type="button">Simulate</button>
            <ol aria-label="Evaluation order">
              {sim.evaluations.map((e, i) => (
                <li key={e.name}>{formatEvaluationStep(e, i)}</li>
              ))}
            </ol>
            {sim.denial ? (
              <p role="status" data-denial={sim.denial.code}>
                {formatDenial(sim.denial)}
              </p>
            ) : (
              <p role="status">Allowed</p>
            )}
          </section>

          {GATES_LIST_FIXTURE.widenings.length > 0 ? (
            <section aria-label="Permission widenings">
              <h3>Deploy widenings</h3>
              <ul>
                {GATES_LIST_FIXTURE.widenings.map((w) => (
                  <li key={w.path}>{w.summary}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      </main>
    </div>
  );
}
