/**
 * Decisions list and review queue. A Flows route, not a sidebar module.
 */

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type JSX } from "react";
import {
  decisionList,
  decisionQueue,
  decisionResolve,
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
  const [suspended, setSuspended] = useState(false);
  const [rows, setRows] = useState<readonly DecisionQueueRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await decisionList();
    if (list.data) {
      setDecisions(list.data.decisions);
      setSuspended(list.data.suspended);
    }
    const queue = await decisionQueue();
    if (queue.data) setRows(queue.data.rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function approve(row: DecisionQueueRow): Promise<void> {
    const result = await decisionResolve({
      id: row.id,
      values: {},
      ...(row.labelOnly ? { labelOnly: true } : {}),
    });
    if (result.error?.code === "Conflict") {
      setNotice("Conflict");
    } else if (result.error?.code === "JournalLeaseBusy") {
      setNotice("JournalLeaseBusy");
    } else if (result.error) {
      setNotice(result.error.code);
    } else {
      setNotice(null);
    }
    await reload();
  }

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="decisions-page">
      <div className={EXPLORER_STRIP_CLASS}>
        <Link to="/flows" className={`${SECTION_HEAD_CLASS} px-2.5`}>
          Flows
        </Link>
        <span className={`${SECTION_HEAD_CLASS} px-2.5`}>Decisions</span>
        <span className={EXPLORER_COUNT_CLASS}>{suspended ? "suspended" : "open"}</span>
      </div>
      <ul>
        {decisions.map((decision) => (
          <li key={decision.name} className={EXPLORER_ROW_CLASS} data-state={decision.state}>
            <span className="min-w-0 flex-1 truncate">{decision.name}</span>
            <span className={EXPLORER_COUNT_CLASS}>{decision.state}</span>
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
          <li key={`${row.labelOnly ? "label" : "park"}:${row.id}`} className={EXPLORER_ROW_CLASS}>
            <span className="min-w-0 flex-1 truncate">
              {row.decision}
              {row.labelOnly ? " · label" : ""}
            </span>
            <span className={EXPLORER_COUNT_CLASS} data-slot="decision-age">
              {formatAge(row.ageMs)}
            </span>
            <button
              type="button"
              className="text-xs"
              disabled={row.status !== "pending"}
              onClick={() => void approve(row)}
            >
              Approve
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
