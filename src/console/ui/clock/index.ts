/**
 * Clock panel pure modules (console §9.6).
 */

export type {
  CatchUpPolicy,
  ClockCronRecord,
  ClockListResponse,
  CronHealth,
  CronStatus,
  DstAmbiguityView,
  TimelineEvent,
  WaitingOnCount,
  WaitingOnRecord,
} from "./types.ts";

export { CLOCK_LIST_FIXTURE } from "./fixture.ts";

export {
  parseClockSearch,
  serializeClockSearch,
  openCron,
  openWake,
  closeClockDetail,
  type ClockSearch,
} from "./search.ts";

export { forwardTimeline, formatTimelineWhen } from "./timeline.ts";

export {
  aggregateByLabel,
  waitingOnBanner,
  formatWakeIn,
  filterWaitingOn,
} from "./waiting-on.ts";

export { formatHealth, filterCrons, type HealthLines } from "./health.ts";

export {
  overdueCronFindings,
  type OverdueCronFinding,
} from "./findings.ts";

export {
  runNowConfirmation,
  validateTypedConfirm,
  UNDO_WINDOW_MS,
  type ConfirmationPattern,
} from "./confirmation.ts";
