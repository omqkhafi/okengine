/**
 * Protocol-named drivers, tree-shaken by the Manifest.
 *
 * Subpath: `okengine/drivers/*`
 */

export type {
  StoreDriverId,
  DriverFacet,
  SqlRole,
  SqlRow,
  SqlConnectOptions,
  SqlConnection,
  SqlDriver,
  KvNamespace,
  KvOpenOptions,
  KvClientLike,
  KvDriver,
  FilesBucket,
  FilesOpenOptions,
  S3ClientLike,
  FilesDriver,
  IndexHit,
  IndexStore,
  IndexOpenOptions,
  IndexDriver,
  StoreDriver,
  ClassificationMap,
} from "./types.ts";
export { classificationKey } from "./types.ts";

export type {
  SignalDriverId,
  SignalDriver,
  SignalBus,
  SignalMessage,
  SignalFailureReason,
  DeadLetter,
  SignalTransaction,
  SignalOpenOptions,
  SignalRedisClientLike,
  SignalNatsClientLike,
} from "./signal-types.ts";

export {
  memorySqlDriver,
  memoryKvDriver,
  memoryFilesDriver,
  memoryIndexDriver,
  memoryDrivers,
} from "./memory.ts";

export { sqliteDriver, connectSqlite } from "./sqlite.ts";

export {
  postgresDriver,
  connectPostgres,
  createPostgresFakeClient,
  toPostgresParams,
  type PostgresClientLike,
} from "./postgres.ts";

export {
  redisDriver,
  openRedisKv,
  createRedisFakeClient,
} from "./redis.ts";

export { fsDriver, openFsBucket } from "./fs.ts";

export {
  s3Driver,
  openS3Bucket,
  createS3FakeClient,
} from "./s3.ts";

export { pgvectorDriver, openPgvectorIndex } from "./pgvector.ts";

export {
  memorySignalDriver,
  openMemorySignal,
} from "./signal-memory.ts";

export {
  postgresSignalDriver,
  openPostgresSignal,
  createPostgresSignalFake,
  type PostgresSignalSql,
} from "./signal-postgres.ts";

export {
  redisSignalDriver,
  openRedisSignal,
  createSignalRedisFake,
} from "./signal-redis.ts";

export {
  natsSignalDriver,
  openNatsSignal,
  createSignalNatsFake,
} from "./signal-nats.ts";

export {
  runSqlConformance,
  runKvConformance,
  runFilesConformance,
  runIndexConformance,
} from "./conformance.ts";
