/**
 * Static Access markup for the axe gate — same landmarks as the live panel
 * (console §9.14).
 */

import {
  ONCE_SECRET_ACK_LABEL,
  ONCE_SECRET_WARNING,
} from "./acknowledgement.ts";
import { formatAccessBlastRadius } from "./blast-radius.ts";
import {
  ACCESS_BLAST_FIXTURE,
  ACCESS_EFFECTIVE_FIXTURE,
  ACCESS_LIST_FIXTURE,
} from "./fixture.ts";
import { hygieneLines } from "./hygiene.ts";
import { formatProvenance } from "./provenance.ts";

/** Props for {@link AccessA11yView}. */
export interface AccessA11yViewProps {
  /** Focused plane. */
  readonly plane?: "operator" | "user";
  /** Open key id for revoke / once-secret surfaces. */
  readonly openKeyId?: string;
  /** Show once-secret acknowledgement surface. */
  readonly showOnceSecret?: boolean;
}

/**
 * Accessible Access list + detail for CI.
 *
 * @param props - Plane / open key
 */
export function AccessA11yView(props: AccessA11yViewProps) {
  const plane = props.plane ?? "user";
  const section =
    plane === "operator"
      ? ACCESS_LIST_FIXTURE.operatorPlane
      : ACCESS_LIST_FIXTURE.userPlane;
  const openKeyId = props.openKeyId ?? "key_demo";
  const openKey = section.keys.find((k) => k.id === openKeyId);
  const blast = formatAccessBlastRadius(ACCESS_BLAST_FIXTURE);
  const lines = hygieneLines(ACCESS_LIST_FIXTURE.hygiene);
  const provenance = formatProvenance(ACCESS_EFFECTIVE_FIXTURE);

  return (
    <div className="access-a11y">
      <a href="#access-main">Skip to main content</a>
      <header>
        <h1>Access</h1>
        <p>Identities, roles, API keys — planes never merge</p>
        <div role="group" aria-label="Plane">
          <button type="button" aria-pressed={plane === "operator"}>
            Operator plane
          </button>
          <button type="button" aria-pressed={plane === "user"}>
            User plane
          </button>
        </div>
        <label>
          Filter access
          <input aria-label="Filter access" defaultValue="" />
        </label>
      </header>

      {lines.length > 0 ? (
        <section aria-label="Access hygiene" role="status">
          <h2>Hygiene</h2>
          <ul>
            {lines.map((line) => (
              <li key={line.code}>{line.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <main id="access-main">
        <section aria-label={`${plane} plane`}>
          <h2>{plane === "operator" ? "Operator plane" : "User plane"}</h2>

          {section.operators ? (
            <section aria-label="Operators">
              <h3>Operators</h3>
              <ul>
                {section.operators.map((op) => (
                  <li key={op.id}>
                    <button type="button" style={{ minHeight: 32, width: "100%" }}>
                      {op.name} ({op.email})
                      {op.neverSignedIn ? (
                        <span role="status"> never signed in</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {section.users ? (
            <section aria-label="Users">
              <h3>Users</h3>
              <ul>
                {section.users.map((u) => (
                  <li key={u.id}>
                    <button type="button" style={{ minHeight: 32, width: "100%" }}>
                      {u.name} ({u.email})
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="Roles">
            <h3>Roles</h3>
            <ul>
              {section.roles.map((r) => (
                <li key={r.id}>
                  <button type="button" style={{ minHeight: 32, width: "100%" }}>
                    {r.name} — {r.scopes.length} scopes
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="API keys">
            <h3>API keys</h3>
            <ul>
              {section.keys.map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    aria-pressed={k.id === openKeyId}
                    style={{ minHeight: 32, width: "100%" }}
                  >
                    {k.name}
                    {k.unused90d ? (
                      <span role="status"> unused 90d+</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Grantable scopes">
            <h3>Grantable scopes</h3>
            <p>
              Only scopes you hold appear — impossibility taught by absence
            </p>
            <ul>
              {section.grantableScopes.map((s) => (
                <li key={s}>
                  <label>
                    <input type="checkbox" disabled /> {s}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </section>

        {openKey ? (
          <section aria-label="Key detail" aria-live="polite">
            <h2>{openKey.name}</h2>
            <p className="font-mono">{openKey.id}</p>

            <section aria-label="Revocation blast radius">
              <h3>Revocation blast radius</h3>
              <p role={blast.warn ? "alert" : "status"}>{blast.volume}</p>
              <p>{blast.lastUsed}</p>
              <p>{blast.sources}</p>
              <p role="status">{blast.residual}</p>
            </section>

            <section aria-label="Revoke key">
              <h3>Revoke</h3>
              <label>
                Type REVOKE to confirm
                <input aria-label="Type REVOKE to confirm" defaultValue="" />
              </label>
              <label>
                Reason
                <input aria-label="Revoke reason" defaultValue="" />
              </label>
              <button type="button">Revoke key</button>
            </section>
          </section>
        ) : null}

        <section aria-label="Effective permissions">
          <h2>Effective permissions</h2>
          <p>Every permission with provenance — inverse of the Gates simulator</p>
          <table>
            <caption>Effective permissions with provenance</caption>
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">Granted by</th>
              </tr>
            </thead>
            <tbody>
              {provenance.map((row) => (
                <tr key={row.scope}>
                  <td>{row.scope}</td>
                  <td>{row.sources}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {props.showOnceSecret ? (
          <section
            aria-label="New API key secret"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="once-secret-title"
          >
            <h2 id="once-secret-title">New API key secret</h2>
            <p role="alert">{ONCE_SECRET_WARNING}</p>
            <p>
              <code>oke_fixture_secret_shown_once</code>
            </p>
            <label>
              <input type="checkbox" /> {ONCE_SECRET_ACK_LABEL}
            </label>
            <button type="button" disabled>
              Dismiss secret
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
