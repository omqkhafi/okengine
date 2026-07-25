/**
 * Clock element — time.
 *
 * Physics: cron · delay · timeout · durable sleep · TTL.
 * Drivers (protocol-named): `memory` · `postgres`.
 *
 * Durability lives on the Flow (`durable: true`); the journal records every
 * `fx` call. Crons leader-elect; schedules are reconciled into the Store at
 * boot (console §5).
 * @module
 */

export { clock } from "./clock/declare.ts";
export type { ClockDecl, ClockOptions } from "./clock/declare.ts";

export { parseDurationMs } from "./clock/duration.ts";

export {
  detectDstAmbiguity,
  type DstAmbiguity,
} from "./clock/dst.ts";

export {
  tryAcquireLease,
  releaseLease,
  type AcquireLeaseOptions,
  type LeaseStore,
  type LeaseTarget,
} from "./clock/leader.ts";

export {
  reconcileClocks,
  effectiveSchedule,
  createMemoryCronStore,
  type CronRow,
  type CronStatus,
  type CronStore,
  type ReconcileResult,
} from "./clock/reconcile.ts";

export {
  createTimeTravel,
  type TimeTravel,
} from "./clock/time-travel.ts";

export {
  createClockRuntime,
  createTestClockRuntime,
  type ClockRuntime,
  type CreateClockRuntimeOptions,
  type CronHandler,
} from "./clock/runtime.ts";

export {
  runDurable,
  type DurableResult,
  type RunDurableOptions,
} from "./clock/durable.ts";

export {
  cronHealth,
  type CatchUpPolicy,
  type CronHealth,
} from "./clock/health.ts";

export {
  nextOccurrences,
  previousOccurrence,
  countMissedOccurrences,
} from "./clock/schedule.ts";

export {
  pauseCron,
  editSchedule,
  wakeEarly,
  ScheduleNotOverridableError,
  ClockResourceNotFoundError,
  type EditScheduleInput,
  type WakeEarlyOptions,
  type WakeEarlyResult,
} from "./clock/actions.ts";
