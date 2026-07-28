/**
 * Runs store — wide events, Parquet + DuckDB, outlier explanation, crypto-shred.
 *
 * Not a ninth element: observability derived from the effect system.
 * Subpath: planned as part of the Console / runtime surface.
 * @module
 */

export type {
  RunsDriverId,
  RunLogLine,
  RunError,
  RunDimensions,
  WideEvent,
  RunsRetention,
  RunsRow,
  RunsStore,
  RunsDriver,
  RunsOpenOptions,
} from "./types.ts";

export {
  createRunTelemetry,
  cacheDimensionOf,
  type RunTelemetry,
} from "./telemetry.ts";

export {
  collectWideEvent,
  type CollectWideEventInput,
} from "./collect.ts";

export {
  explainOutliers,
  seedOutlierDataset,
  type OutlierFinding,
  type ExplainOutliersOptions,
} from "./outlier.ts";

export {
  SUBJECT_KEY_PREFIX,
  SHREDDED,
  subjectKeyName,
  subjectKeysFromVault,
  createMemorySubjectKeys,
  ensureSubjectKey,
  archiveFields,
  revealArchived,
  eraseSubject,
  type SubjectKeyVault,
} from "./shred.ts";

export {
  wideEventToRow,
  rowToWideEvent,
  writeParquet,
  readParquet,
  partitionKey,
  partitionObjectKey,
  type ParquetRow,
} from "./parquet.ts";

export { openDuckDB, duckQuery, duckPath, duckLiteral } from "./duckdb.ts";

export {
  createRunsRuntime,
  resolveRunsDriver,
  filesRunsDriver,
  memoryRunsDriver,
  postgresRunsDriver,
  clickhouseRunsDriver,
  type CreateRunsRuntimeOptions,
  type RunsRuntime,
} from "./runtime.ts";

export {
  privacyErase,
  type PrivacyEraseOptions,
  type PrivacyEraseResult,
} from "./privacy.ts";

export { createRunsPostgresFake } from "./drivers/postgres.ts";
export {
  createRunsClickHouseFake,
  createRunsClickHouseHttp,
  ensureClickHouseRunsTable,
} from "./drivers/clickhouse.ts";

export {
  withOtelExport,
  createOtelStore,
  otlpHttpJsonTransport,
  type OtelExportOptions,
  type OtelTransport,
} from "./drivers/otel.ts";

export {
  wideEventToOtlpSpan,
  wideEventToOtlpExportRequest,
  toOtelId,
  msToUnixNano,
  type OtlpSpan,
  type OtlpExportTracesServiceRequest,
  type WideEventOtlpOptions,
} from "./otel-map.ts";
