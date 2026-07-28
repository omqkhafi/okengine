/**
 * Static Channels markup for the axe gate — same landmarks / roles as the
 * live panel (console §9.9).
 */

import { formatFallbackLine } from "./fallback.ts";
import { CHANNELS_LIST_FIXTURE } from "./fixture.ts";
import { formatLocaleChainDisplay } from "./locale.ts";
import {
  isConsequenceEmphasized,
  sortByConsequence,
  STATE_LABEL,
  VERDICT_LABEL,
} from "./taxonomy.ts";

/** Props for {@link ChannelsA11yView}. */
export interface ChannelsA11yViewProps {
  /** Template to open in detail. */
  readonly openTemplate?: string;
}

/**
 * Accessible Channels list + detail for CI.
 *
 * @param props - Open template
 */
export function ChannelsA11yView(props: ChannelsA11yViewProps) {
  const list = CHANNELS_LIST_FIXTURE;
  const openName = props.openTemplate ?? "otp-code";
  const open = list.templates.find((t) => t.name === openName);
  const outcomes = sortByConsequence(list.outcomes);
  const previewLocale = open?.locales[1] ?? open?.locales[0] ?? "en";
  const dir = previewLocale.startsWith("ar") ? "rtl" : "ltr";

  return (
    <div className="channels-a11y">
      <a href="#channels-main">Skip to main content</a>
      <header>
        <h1>Channels</h1>
        <p>
          {list.face === "inbox"
            ? "Dev inbox — all media land here"
            : "Deliverability — seven states of did not arrive"}
        </p>
        <label>
          Filter templates
          <input aria-label="Filter templates" defaultValue="" />
        </label>
      </header>
      <main id="channels-main">
        <section aria-label="Templates">
          <h2>Templates</h2>
          <ul>
            {list.templates.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  aria-pressed={t.name === openName}
                  style={{ minHeight: 32, width: "100%" }}
                >
                  <span>{t.name}</span>
                  <span> {t.medium}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Did not arrive" aria-live="polite">
          <h2>Did not arrive</h2>
          <table>
            <caption>Seven-state taxonomy with verdicts</caption>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Count</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((row) => (
                <tr
                  key={row.state}
                  data-emphasized={isConsequenceEmphasized(row) ? "true" : undefined}
                >
                  <th scope="row">{STATE_LABEL[row.state]}</th>
                  <td>{row.count}</td>
                  <td>{VERDICT_LABEL[row.verdict]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-label="Fallback chains">
          <h2>Fallback</h2>
          <p role="status">{formatFallbackLine(list.fallback)}</p>
        </section>

        {open ? (
          <section aria-label="Template detail" aria-live="polite">
            <h2>{open.name}</h2>
            <p>
              From {open.from ?? "unset"} · Locales {open.locales.join(", ") || "none"}
            </p>
            <section aria-label="Email authentication">
              <h3>SPF / DKIM / DMARC</h3>
              <ul>
                <li>SPF: pass</li>
                <li>DKIM: pass</li>
                <li>DMARC: missing</li>
              </ul>
            </section>
            <section aria-label="Locale preview">
              <h3>Preview</h3>
              <p>
                Locale chain:{" "}
                {formatLocaleChainDisplay(["profile:ar", "accept-language:ar", "default:en"])}
              </p>
              <div dir={dir} lang={previewLocale}>
                <p>رمز 1234</p>
              </div>
            </section>
            <section aria-label="Send test">
              <h3>Send test</h3>
              <p role="status">Real send to a designated recipient — not a dry run</p>
              <label>
                Recipient
                <input aria-label="Test recipient" defaultValue="" />
              </label>
              <label>
                Type SEND to confirm
                <input aria-label="Type SEND to confirm" defaultValue="" />
              </label>
              <label>
                Reason
                <input aria-label="Reason for send test" defaultValue="" />
              </label>
              <button type="button" style={{ minHeight: 32 }}>
                Send test
              </button>
            </section>
          </section>
        ) : null}

        <section aria-label="Suppression list">
          <h2>Suppression</h2>
          <ul>
            {list.suppression.map((s) => (
              <li key={`${s.subjectMasked}-${s.reason}-${s.at}`}>
                {s.subjectMasked} · {s.reason} · {s.medium}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Recent receipts">
          <h2>Receipts</h2>
          <ul>
            {list.receipts.map((r) => (
              <li key={r.id}>
                {r.template} → {r.toMasked} · {r.status}
                {r.chain ? ` · ${r.chain}` : ""}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
