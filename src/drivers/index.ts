/**
 * Protocol-named drivers, tree-shaken by the Manifest.
 *
 * Subpath: `okengine/drivers/*`
 * @module
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
  VectorIndexStore,
  TextIndexStore,
  TextIndexSearchOptions,
  TextIndexSearchResult,
  IndexOpenOptions,
  IndexDriver,
  VectorIndexDriver,
  TextIndexDriver,
  StoreDriver,
  ClassificationMap,
} from "./types.ts";
export { classificationKey, indexDriverNeedsSql } from "./types.ts";

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
  SignalStats,
  SignalSubscriberStats,
  SignalReplayOptions,
  SignalReplayResult,
  SignalReplayMessageResult,
  SignalDiscardOptions,
} from "./signal-types.ts";

export { SIGNAL_DEFAULT_LEASE_MS } from "./signal-types.ts";

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

export { redisDriver, openRedisKv, createRedisFakeClient, createBunRedisClient } from "./redis.ts";

export { LuaKvStore, registerLuaScript, hasLuaScript } from "./kv-lua.ts";

export { fsDriver, openFsBucket } from "./fs.ts";

export { s3Driver, openS3Bucket, createS3FakeClient } from "./s3.ts";

export { pgvectorDriver, openPgvectorIndex } from "./pgvector.ts";

export { libsqlDriver, connectLibsql, libsqlIndexDriver, openLibsqlIndex } from "./libsql.ts";

export {
  meilisearchDriver,
  openMeilisearchIndex,
  MeilisearchUnavailableError,
  type MeilisearchIndexOptions,
} from "./meilisearch.ts";

export { pgliteDriver, connectPglite } from "./pglite.ts";

export { memorySignalDriver, openMemorySignal } from "./signal-memory.ts";

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
  createBunSignalRedisClient,
  parseXreadgroupReply,
} from "./signal-redis.ts";

export { natsSignalDriver, openNatsSignal, createSignalNatsFake } from "./signal-nats.ts";

// Conformance helpers are test-only — import from `okengine/drivers/conformance`.

export type { VaultDriverId, VaultOpenOptions, VaultBag, VaultDriver } from "./vault-types.ts";

export { memoryVaultDriver } from "./vault-memory.ts";
export { envVaultDriver } from "./vault-env.ts";
export { openbaoVaultDriver, OpenBaoUnavailableError } from "./vault-openbao.ts";
export { managedVaultDriver } from "./vault-managed.ts";

export type {
  ChannelDriverId,
  ChannelMediumId,
  ChannelMessage,
  ChannelAttempt,
  ChannelSendResult,
  ChannelTransport,
  ChannelDriver,
  ChannelOpenOptions,
  ChannelInbox,
  ChannelInboxEntry,
} from "./channel-types.ts";
export { createChannelInbox } from "./channel-types.ts";

export { consoleChannelDriver, openConsoleChannel } from "./channel-console.ts";
export { smtpChannelDriver, openSmtpChannel } from "./channel-smtp.ts";
export { resendChannelDriver, openResendChannel } from "./channel-resend.ts";
export { sndrChannelDriver, openSndrChannel } from "./channel-sndr.ts";
export { taqnyatChannelDriver, openTaqnyatChannel } from "./channel-taqnyat.ts";
export { msegatChannelDriver, openMsegatChannel } from "./channel-msegat.ts";
export { unifonicChannelDriver, openUnifonicChannel } from "./channel-unifonic.ts";
export { waCloudChannelDriver, openWaCloudChannel } from "./channel-wa-cloud.ts";
export { fcmChannelDriver, openFcmChannel } from "./channel-fcm.ts";
export { webpushChannelDriver, openWebPushChannel } from "./channel-webpush.ts";
export { mapSentlySendResult, mapSentlySendError } from "./channel-sently-map.ts";

export type {
  AiDriverId,
  AiMessage,
  AiToolDef,
  AiToolCall,
  AiCompleteOptions,
  AiCompleteResult,
  AiStreamChunk,
  AiEmbedOptions,
  AiEmbedResult,
  AiModelClient,
  AiOpenOptions,
  AiDriver,
} from "./ai-types.ts";

export { mockAiDriver, createMockAiDriver } from "./ai-mock.ts";
export { anthropicAiDriver, openAnthropic } from "./ai-anthropic.ts";
export {
  openaiCompatibleAiDriver,
  openOpenaiCompatible,
  OPENAI_COMPAT_DEFAULT_BASE,
  normalizeOpenaiCompatibleBaseUrl,
  isOpenaiCloudBase,
  openaiCompatibleHeaders,
} from "./ai-openai-compatible.ts";
export {
  ollamaAiDriver,
  openOllama,
  OllamaUnavailableError,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_BASE_URL,
  normalizeOllamaBaseUrl,
  resolveOllamaBaseUrl,
  resolveOllamaModel,
} from "./ai-ollama.ts";
