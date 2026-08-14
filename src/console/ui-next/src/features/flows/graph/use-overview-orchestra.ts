/**
 * Conduct the Overview orchestra — mint notes into the runs cache and
 * expose the current flow so the orbit can light that path.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { RunRow } from "@/client.ts";
import { mergeRun } from "../data/console-live-session.ts";
import { RUNS_QUERY_KEY } from "../data/use-runs.ts";
import {
  materializeOrchestraRun,
  nextOrchestraDelayMs,
  ORCHESTRA_HOLD_MS,
  pickOrchestraTemplate,
} from "./orchestra.ts";

/** Current orchestra note on the orbit. */
export type OrchestraNote = {
  readonly flowId: string;
  readonly runId: string;
};

/**
 * Start the orchestra when Overview is open and idle.
 *
 * @param options.enabled - Manifest + repertoire are ready
 * @param options.paused - User is inspecting a run or neighborhood
 */
export function useOverviewOrchestra(options: {
  readonly enabled: boolean;
  readonly paused: boolean;
}): OrchestraNote | null {
  const qc = useQueryClient();
  const [note, setNote] = useState<OrchestraNote | null>(null);
  const seq = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(options.paused);
  pausedRef.current = options.paused;

  useEffect(() => {
    if (!options.enabled) return;

    const clearHold = () => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
    };

    const play = () => {
      if (pausedRef.current || document.hidden) return;
      const runs = qc.getQueryData<RunRow[]>(RUNS_QUERY_KEY) ?? [];
      const template = pickOrchestraTemplate(runs);
      if (!template) return;
      seq.current += 1;
      const minted = materializeOrchestraRun(template, Date.now(), seq.current);
      qc.setQueryData<RunRow[]>(RUNS_QUERY_KEY, (old) => mergeRun(old ?? [], minted));
      setNote({ flowId: minted.flow, runId: minted.id });
      clearHold();
      holdTimer.current = setTimeout(() => {
        setNote(null);
        holdTimer.current = null;
      }, ORCHESTRA_HOLD_MS);
    };

    const schedule = (delay: number) => {
      beatTimer.current = setTimeout(() => {
        play();
        schedule(nextOrchestraDelayMs());
      }, delay);
    };

    schedule(700);
    const onVis = () => {
      if (document.hidden) {
        setNote(null);
        clearHold();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (beatTimer.current) clearTimeout(beatTimer.current);
      clearHold();
      setNote(null);
    };
  }, [options.enabled, qc]);

  if (options.paused) return null;
  return note;
}
