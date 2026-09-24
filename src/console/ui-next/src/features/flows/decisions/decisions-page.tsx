/**
 * Decisions list and review queue. A Flows route, not a sidebar module.
 */

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type JSX } from "react";
import {
  decisionList,
  decisionQueue,
  decisionResolve,
  type DecisionLabelFailure,
  type DecisionListRow,
  type DecisionQueueRow,
} from "@/client.ts";
import {
  EXPLORER_COUNT_CLASS,
  EXPLORER_PAGE_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { decisionStateLabel, decisionValuesValid, resolveDecisionWithRetry } from "./resolve.ts";

/**
 * Format a pending age in seconds or minutes.
 *
 * @param ageMs - Milliseconds since the review was requested
 */
function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

/**
 * Decisions catalogue and the review queue.
 */
export function DecisionsPage(): JSX.Element {
  const [decisions, setDecisions] = useState<readonly DecisionListRow[]>([]);
  const [failures, setFailures] = useState<readonly DecisionLabelFailure[]>([]);
  const [rows, setRows] = useState<readonly DecisionQueueRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});

  const reload = useCallback(async () => {
    const list = await decisionList();
    if (list.data) {
      setDecisions(list.data.decisions);
      setFailures(list.data.failures ?? []);
    }
    const queue = await decisionQueue();
    if (queue.data) setRows(queue.data.rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function approve(row: DecisionQueueRow): Promise<void> {
    const draft = values[row.id] ?? {};
    const submitted: Record<string, unknown> = {};
    for (const question of row.questions) {
      const raw = draft[question.id];
      if (question.kind === "boolean") {
        if (raw !== "true" && raw !== "false") continue;
        submitted[question.id] = raw === "true";
      } else if (raw !== undefined) submitted[question.id] = raw;
    }
    if (!decisionValuesValid(row.questions, submitted)) {
      setNotice("ValidationError");
      return;
    }
    const result = await resolveDecisionWithRetry(decisionResolve, {
      id: row.id,
      values: submitted,
      ...(row.labelOnly ? { labelOnly: true } : {}),
    });
    if (result.error?.code === "Conflict") setNotice("Conflict");
    else if (result.error?.code === "JournalLeaseBusy") setNotice("JournalLeaseBusy");
    else if (result.error) setNotice(result.error.code);
    else setNotice(null);
    await reload();
  }

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="decisions-page">
      <div className={EXPLORER_STRIP_CLASS}>
        <Link to="/flows" className={`${SECTION_HEAD_CLASS} px-2.5`}>
          Flows
        </Link>
        <span className={`${SECTION_HEAD_CLASS} px-2.5`}>Decisions</span>
      </div>
      {failures.length > 0 ? (
        <ul>
          {failures.map((failure) => (
            <li
              key={`${failure.at}:${failure.decision}:${failure.question}`}
              className={EXPLORER_ROW_CLASS}
              data-slot="decision-label-error"
            >
              <span className="min-w-0 flex-1 truncate">
                {failure.decision} · {failure.question}
              </span>
              <span className={EXPLORER_COUNT_CLASS}>{failure.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul>
        {decisions.map((decision) => (
          <li
            key={decision.name}
            className={EXPLORER_ROW_CLASS}
            data-state={decisionStateLabel(decision.state)}
            data-decision={decision.name}
          >
            <span className="min-w-0 flex-1 truncate">{decision.name}</span>
            <span className={EXPLORER_COUNT_CLASS}>{decisionStateLabel(decision.state)}</span>
            {decision.metrics ? (
              <span className={EXPLORER_COUNT_CLASS} data-slot="decision-metrics">
                {Object.entries(decision.metrics)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" · ")}
              </span>
            ) : null}
            {decision.promote ? (
              <code className="text-xs" data-slot="decision-promote">
                {decision.promote}
              </code>
            ) : null}
          </li>
        ))}
      </ul>
      <div className={EXPLORER_STRIP_CLASS}>
        <span className={`${SECTION_HEAD_CLASS} px-2.5`}>Review queue</span>
      </div>
      {notice ? (
        <p className="px-2.5 py-1 text-xs" data-slot="decision-notice">
          {notice}
        </p>
      ) : null}
      <ul>
        {rows.map((row) => (
          <li
            key={`${row.labelOnly ? "label" : "park"}:${row.id}`}
            className={EXPLORER_ROW_CLASS}
            data-label-only={row.labelOnly ? "true" : "false"}
          >
            <span className="min-w-0 flex-1 truncate">
              {row.decision}
              {row.labelOnly ? " · label" : ""}
            </span>
            <span className={EXPLORER_COUNT_CLASS} data-slot="decision-age">
              {formatAge(row.ageMs)}
            </span>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void approve(row);
              }}
            >
              {row.questions.map((question) =>
                question.kind === "boolean" ? (
                  <select
                    key={question.id}
                    aria-label={question.id}
                    value={values[row.id]?.[question.id] ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((current) => ({
                        ...current,
                        [row.id]: { ...current[row.id], [question.id]: next },
                      }));
                    }}
                  >
                    <option value="">Select</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <select
                    key={question.id}
                    aria-label={question.id}
                    value={values[row.id]?.[question.id] ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((current) => ({
                        ...current,
                        [row.id]: { ...current[row.id], [question.id]: next },
                      }));
                    }}
                  >
                    <option value="">Select</option>
                    {(question.kind === "choice" ? question.options : question.levels)?.map(
                      (option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ),
                    )}
                  </select>
                ),
              )}
              <button type="submit" className="text-xs" disabled={row.status !== "pending"}>
                Approve
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
