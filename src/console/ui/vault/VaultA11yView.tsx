/**
 * Static Vault markup for the axe gate — same landmarks as the live panel.
 */

import { formatBlastRadius } from "./blast-radius.ts";
import { VAULT_LIST_FIXTURE } from "./fixture.ts";
import { groupByKind } from "./group.ts";

/** Props for {@link VaultA11yView}. */
export interface VaultA11yViewProps {
  /** Optional contract name to open. */
  readonly openName?: string;
}

/**
 * Accessible Vault list + detail for CI.
 *
 * @param props - Open contract
 */
export function VaultA11yView(props: VaultA11yViewProps) {
  const groups = groupByKind(VAULT_LIST_FIXTURE.secrets);
  const openName = props.openName ?? "STRIPE_KEY";
  const open = VAULT_LIST_FIXTURE.secrets.find((s) => s.name === openName);
  const blast = open ? formatBlastRadius(open.blastRadius) : null;
  const env = VAULT_LIST_FIXTURE.env;

  return (
    <div className="vault-a11y">
      <a href="#vault-main">Skip to main content</a>
      <header>
        <h1>Vault</h1>
        <p>Contracts, fingerprints, resolution — never secret values</p>
        <p role="status">Environment {env}</p>
        <label>
          Filter vault
          <input aria-label="Filter vault" defaultValue="" />
        </label>
      </header>
      <main id="vault-main">
        <section aria-label="Vault list">
          <h2>Contracts</h2>
          {groups.map((group) => (
            <section key={group.kind} aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.secrets.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      aria-pressed={s.name === openName}
                      style={{ minHeight: 32, width: "100%" }}
                    >
                      <span>{s.name}</span>
                      {s.sensitive && s.fingerprint ? (
                        <span> {s.fingerprint}</span>
                      ) : null}
                      {!s.sensitive && s.cleartext ? (
                        <span> {s.cleartext}</span>
                      ) : null}
                      {s.blastRadius.count > 0 ? (
                        <span role="status">
                          {" "}
                          blast {s.blastRadius.count}
                        </span>
                      ) : null}
                      {s.sharedFingerprintEnvs.length > 0 ? (
                        <span role="status"> shared fingerprint</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {open ? (
          <section aria-label="Vault detail" aria-live="polite">
            <h2>{open.name}</h2>
            {open.description ? <p>{open.description}</p> : null}
            <p role="status">
              {open.sensitive
                ? `Fingerprint (${env}): ${open.fingerprint ?? "unset"}`
                : `Value: ${open.cleartext ?? "unset"}`}
            </p>

            <section aria-label="Fingerprints by environment">
              <h3>Fingerprints</h3>
              {open.sensitive ? (
                <ul>
                  {Object.entries(open.fingerprints).map(([e, fp]) => (
                    <li key={e}>
                      {e}: {fp}
                      {open.sharedFingerprintEnvs.includes(e) ? (
                        <span role="status"> (matches {env})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Config is shown in the clear — not fingerprinted.</p>
              )}
            </section>

            <section aria-label="Resolution chain">
              <h3>Resolution chain</h3>
              <ol>
                {open.resolution.map((step) => (
                  <li key={step.source}>
                    {step.source}
                    {step.won
                      ? " — won"
                      : step.present
                        ? " — present (lost)"
                        : " — absent"}
                  </li>
                ))}
              </ol>
              <p role="status">Winner: {open.winner ?? "none"}</p>
            </section>

            <section aria-label="Readers">
              <h3>Readers</h3>
              <p>
                Flows that declare fx.vault({open.name}):{" "}
                {open.readers.join(", ") || "none"}
              </p>
            </section>

            <section aria-label="Rotation blast radius">
              <h3>Rotation blast radius</h3>
              {blast ? (
                <>
                  <p role={blast.warn ? "alert" : "status"}>{blast.summary}</p>
                  {blast.detail ? <p>{blast.detail}</p> : null}
                </>
              ) : null}
            </section>

            <section aria-label="Last read">
              <h3>Last read</h3>
              <p role="status">
                {open.lastReadAt != null
                  ? new Date(open.lastReadAt).toISOString()
                  : "Never read — possible dead secret"}
              </p>
            </section>

            <section aria-label="Set or rotate">
              <h3>Set / rotate</h3>
              <p>Write-only — values are never revealed after submit.</p>
              <label>
                New value
                <input
                  aria-label="New vault value"
                  type="password"
                  autoComplete="off"
                  defaultValue=""
                />
              </label>
              <label>
                Confirmation
                <input aria-label="Confirmation phrase" defaultValue="" />
              </label>
              <label>
                Reason
                <input aria-label="Reason for vault write" defaultValue="" />
              </label>
              <button type="button">Set</button>
              <button type="button">Rotate</button>
            </section>
          </section>
        ) : null}
      </main>
    </div>
  );
}
