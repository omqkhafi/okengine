/**
 * Re-export run telemetry from the kernel (collected through `fx`).
 */

export {
  createRunTelemetry,
  cacheDimensionOf,
  type RunLogLine,
  type RunTelemetry,
} from "../kernel/run-telemetry.ts";
