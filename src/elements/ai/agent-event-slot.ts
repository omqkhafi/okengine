/**
 * Installed agent event log.
 *
 * The follow route and the AI runtime must share one slot. The log
 * implementation stays in `run-events.ts` and loads on first use; this file
 * is the only static edge so a `lazyRequire` copy cannot hide the log.
 */

import type { AgentEventLog } from "./run-events.ts";

let activeLog: AgentEventLog | undefined;

/**
 * Install the log the follow route reads. Boot and tests call this.
 *
 * @param log - Active log
 */
export function setAgentEventLog(log: AgentEventLog | undefined): void {
  activeLog = log;
}

/**
 * Log installed by the running AI runtime.
 */
export function getAgentEventLog(): AgentEventLog | undefined {
  return activeLog;
}
