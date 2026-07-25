/**
 * Clock panel view types (console §9.6).
 */

/** Cron lifecycle status. */
export type CronStatus = "active" | "paused" | "orphaned";

/** Catch-up policy matching ClockRuntime physics. */
export type CatchUpPolicy = "one";

/** Four-number cron health. */
export interface CronHealth {
  readonly driftMs: number | null;
  readonly overdue: boolean;
  readonly missedRuns: number;
  readonly catchUp: CatchUpPolicy;
  readonly leaderInstanceId?: string;
  readonly leaderLeaseUntil?: number;
}

/** DST ambiguity payload (only when expression+zone hit gap/overlap). */
export interface DstAmbiguityView {
  readonly kind: "gap" | "overlap";
  readonly reason: string;
  readonly on: string;
  readonly localTime: string;
}

/** One cron row from `console.clock.list`. */
export interface ClockCronRecord {
  readonly name: string;
  readonly status: CronStatus;
  readonly timezone: string;
  readonly overridable: boolean;
  readonly declaredCron?: string;
  readonly declaredEvery?: string;
  readonly effectiveCron?: string;
  readonly effectiveEvery?: string;
  readonly lastRunAt?: number;
  readonly nextRunAt?: number;
  readonly health: CronHealth;
  readonly dstAmbiguity: DstAmbiguityView | null;
  readonly external: boolean;
  readonly flowIds: readonly string[];
}

/** Sleeping durable run in the waiting-on list. */
export interface WaitingOnRecord {
  readonly runId: string;
  readonly flow: string;
  readonly label: string;
  readonly wakeAt: number;
  readonly wakeInMs: number;
  readonly step: string | null;
}

/** Aggregate by sleep label. */
export interface WaitingOnCount {
  readonly label: string;
  readonly count: number;
}

/** Forward timeline event. */
export interface TimelineEvent {
  readonly at: number;
  readonly kind: "cron" | "wake";
  readonly name: string;
  readonly meta?: string;
}

/** List response envelope. */
export interface ClockListResponse {
  readonly now: number;
  readonly crons: readonly ClockCronRecord[];
  readonly waitingOn: readonly WaitingOnRecord[];
  readonly waitingOnCounts: readonly WaitingOnCount[];
  readonly timeline: readonly TimelineEvent[];
}
