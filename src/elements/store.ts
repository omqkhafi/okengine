/**
 * Store element — data at rest.
 *
 * Facets: `sql` · `kv` · `files` · `index`.
 * Drivers are protocol-named and live under `src/drivers/*`.
 * All world access still goes through `fx`; this module only declares
 * resources and provides runtime helpers (cache, replica routing, PII).
 * @module
 */

export { store, sql, kv, files, index } from "./store/declare.ts";
export type {
  StoreDecl,
  SqlStoreDecl,
  KvStoreDecl,
  FilesStoreDecl,
  IndexStoreDecl,
  SqlStoreOptions,
  KvStoreOptions,
  FilesStoreOptions,
  IndexStoreOptions,
} from "./store/declare.ts";

export {
  field,
  schema,
  schemaTable,
  schemaRelations,
  schemaRls,
  schemaPolicy,
  schemaPolicyGate,
  schemaPolicyOwner,
  schemaPolicyScope,
  schemaPolicyTenant,
  schemaUnscoped,
  isSchemaTableDecl,
  isSchemaColumnDecl,
  isSchemaRelationsDecl,
  isFieldBuilder,
  finalizeColumnMap,
  tablesFromExports,
  relationsFromExports,
} from "./store/schema-decl.ts";
export type {
  FieldBuilder,
  FieldSqlType,
  DefaultFnKind,
  SchemaColumnDecl,
  SchemaColumnInput,
  SchemaTableDecl,
  SchemaTableWithColumns,
  InferColumnJs,
  FinalizeColumn,
  SchemaRelationsDecl,
  SchemaPolicyDecl,
  SchemaTableExtra,
  SchemaRelationEntry,
  SchemaRelationOne,
  SchemaRelationMany,
  RelationColumnRef,
  ReferenceAction,
  ReferenceActions,
  ColumnReference,
} from "./store/schema-decl.ts";

export {
  classify,
  buildClassificationMap,
  maskRows,
  isPiiColumn,
  piiNameAliases,
  addPiiFieldName,
  expandPiiNames,
  piiLogicalCount,
  tableFromSql,
  PII_MASK,
} from "./store/classify.ts";
export type { MaskRowsOptions } from "./store/classify.ts";

export {
  createStoreCache,
  computedCacheKey,
  tier1KeysForReads,
  tier1FlowDims,
  tier1DimsByResource,
  autoCacheEligible,
  resourcesTouchedByWrites,
  isInvalidatedByWrite,
  parseTtlMs,
} from "./store/cache.ts";
export type { CacheTier, CacheEntry, InvalidationEvent, StoreCache } from "./store/cache.ts";

export { isReadOnlyStoreFlow, sqlRoleForEffects, resolveSqlTarget } from "./store/replica.ts";
export type { SqlBindingConfig } from "./store/replica.ts";

export {
  defineTable,
  resolveTableName,
  classificationsFromTable,
  id,
  now,
  nowIso,
  nowDate,
} from "./store/table.ts";
export type { ColumnDef, TableHandle } from "./store/table.ts";

export { resource } from "./store/resource.ts";
export type {
  ColumnScope,
  ListCountMode,
  ListPageMode,
  ResourceColumns,
  ResourceDef,
  ResourceFlowDefs,
  ResourceListOptions,
  ResourceOptions,
  ResolvedListConfig,
} from "./store/resource.ts";

export { liveQuery } from "./store/live-query.ts";
export type { ListOptions } from "./store/list-query.ts";

export {
  defineSeed,
  normalizeSeedFns,
  resolveSeedCategory,
  resolveSeedIdentity,
  seedPromptMessage,
} from "./store/seed.ts";
export type { SeedCategory, SeedDef, SeedFn, SeedFns, SeedIdentity } from "./store/seed.ts";

export { createSqlStoreHandle, resolvePkColumn } from "./store/sql-session.ts";
export type {
  SqlStoreHandle,
  SelectBuilder,
  SelectFromBuilder,
  SelectWhereBuilder,
  SelectOrderBuilder,
  InferSelectRow,
  InsertBuilder,
  InsertValuesBuilder,
  SqlSessionOptions,
  SqlPageOptions,
  UpsertResult,
  UpsertStatus,
  WhereMap,
} from "./store/sql-session.ts";

export {
  resolveRlsIdentity,
  rlsIdentityFromAuth,
  firstPolicyOrPublic,
  policyGateForScopes,
} from "./store/rls-identity.ts";
export type { RlsIdentityRow, ResolveRlsIdentityInput } from "./store/rls-identity.ts";
export { createStoreRuntime, putTier2 } from "./store/runtime.ts";
export type {
  StoreRuntime,
  StoreDriverBundle,
  StoreHandle,
  StoreInvokeContext,
  CreateStoreRuntimeOptions,
  SqlRuntimeBinding,
  KvStoreFxHandle,
  FilesStoreFxHandle,
  IndexStoreFxHandle,
  VectorIndexStoreFxHandle,
  TextIndexStoreFxHandle,
} from "./store/runtime.ts";

export {
  fileKeyWarnings,
  contentAddressedKey,
  projectFileKeys,
  inferFileContentType,
  isAsciiObjectKey,
  slugFileSegment,
  safeFilePrefix,
  safeFileObjectKey,
  coerceSafeFileObjectKey,
} from "./store/files-policy.ts";
export type { FileKeyWarning } from "./store/files-policy.ts";

export {
  SearchConfigError,
  SEARCH_LOW_CORPUS_WARN_N,
  RRF_DEFAULT_K,
  LSH_DEFAULT_K,
  BM25_K1,
  BM25_B,
} from "./store/search-errors.ts";
export { bm25fScore, tokenize, termFrequencies } from "./store/search-bm25.ts";
export {
  generateHyperplanes,
  hyperplaneSeed,
  lshBucket,
  cosineSimilarity,
  neighborBuckets,
  serializePlanes,
  deserializePlanes,
} from "./store/search-lsh.ts";
export { fuseRrf, fuseWeighted, fuseLists } from "./store/search-fusion.ts";
export type { FuseOptions, FuseStrategy, RankedHit } from "./store/search-fusion.ts";
export { runSqlSearch } from "./store/search-runtime.ts";
export type { SqlSearchOptions, SqlSearchResult, SearchColumnMeta } from "./store/search-runtime.ts";
export {
  searchDdlForTable,
  ensureHyperplaneInserts,
  embColumn,
  lshColumn,
  OKE_TSV_COL,
  SEARCH_PG_MIN_MAJOR,
  parsePgMajor,
} from "./store/search-ddl.ts";
export { runSearchBackfill } from "./store/search-backfill.ts";
export type { SearchBackfillOptions, SearchBackfillResult } from "./store/search-backfill.ts";
export {
  searchEmbedFlowName,
  tablesNeedingSearchEmbed,
  applySearchEmbedCdc,
} from "./store/search-embed-flow.ts";
export { bindSearchEmbedFlows } from "./store/search-bind.ts";
export type { SearchableOptions, EmbedFieldOptions, ColumnSearchDecl } from "./store/schema-decl.ts";
export {
  createFilesImagePipeline,
  putImageToBucket,
  variantObjectKey,
  resolveFilesImageCtorOptions,
  DEFAULT_FILES_IMAGE_MAX_PIXELS,
} from "./store/files-image.ts";
export type {
  FilesImageMeta,
  FilesImageOptions,
  FilesImageResizeOptions,
  FilesImageModulateOptions,
  FilesImageJpegOptions,
  FilesImagePngOptions,
  FilesImageWebpOptions,
  FilesImageQualityOptions,
  FilesImageFormat,
  FilesImagePipeline,
  FilesImageBucketAccess,
  ImageVariantSpec,
  PutImageOptions,
  PutImageResult,
} from "./store/files-image.ts";
