/**
 * Observability SQL console — QueryEditor + QueryResults over persisted runs.
 */

import { useState, type JSX } from "react";
import { PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { EXPLORER_STRIP_CLASS, SECTION_HEAD_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils.ts";
import { QueryEditor } from "@/features/store/query/query-editor.tsx";
import { QueryResults } from "@/features/store/query/query-results.tsx";
import { CallPiiButton } from "@/features/units/call/call-pii-button.tsx";
import { useRunsQuery } from "../data/use-runs-query.ts";

const DEFAULT_SQL = `SELECT flow, count(*) AS runs, round(avg(duration_ms), 1) AS avg_ms
FROM runs
GROUP BY flow
ORDER BY runs DESC`;

/**
 * Opt-in SQL pane. Manual Run only — never polls.
 */
export function RunsQueryPanel(): JSX.Element {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [piiMasked, setPiiMasked] = useState(true);
  const query = useRunsQuery();
  const error =
    query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-slot="runs-query-panel">
      <header className={EXPLORER_STRIP_CLASS}>
        <h2 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>Query</h2>
        <CallPiiButton
          piiMasked={piiMasked}
          disabled={query.isPending}
          onToggle={() => setPiiMasked((v) => !v)}
        />
        <Button
          type="button"
          size="sm"
          className="ml-auto h-full rounded-none"
          disabled={query.isPending || sql.trim().length === 0}
          onClick={() => query.mutate({ sql, ...(piiMasked ? {} : { revealPii: true }) })}
          data-slot="runs-query-run"
        >
          <HugeiconsIcon icon={PlayIcon} className="size-3.5" />
          Run
        </Button>
      </header>
      <p
        className="shrink-0 border-b border-border/60 bg-amber-500/8 px-3 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200"
        data-slot="runs-query-pii-gap"
        role="note"
      >
        Free-form SQL over persisted runs. Masking is column-key only (dim_* and JSON blobs) —
        aliases and expressions can leak classified values. Limitation: RunsQueryPiiProjectionGap.
        Not the same guarantee as GET /console/runs.
      </p>
      <div className="min-h-0 flex-1">
        <QueryEditor
          value={sql}
          onChange={setSql}
          language="sql"
          onRun={() => query.mutate({ sql, ...(piiMasked ? {} : { revealPii: true }) })}
          label="Runs SQL"
        />
      </div>
      <div className="min-h-0 flex-1 border-t border-border/60">
        <QueryResults
          rows={query.data?.rows ?? null}
          error={error}
          pending={query.isPending}
          meta={
            query.data
              ? `${query.data.rowCount} rows${query.data.truncated ? " (truncated)" : ""} · ${query.data.durationMs}ms`
              : null
          }
          executed={sql}
          storeRef="runs"
        />
      </div>
    </div>
  );
}
