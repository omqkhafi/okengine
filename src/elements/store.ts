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
  SchemaRelationsDecl,
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
  tableFromSql,
  PII_MASK,
} from "./store/classify.ts";
export type { MaskRowsOptions } from "./store/classify.ts";

export {
  createStoreCache,
  computedCacheKey,
  tier1KeysForReads,
  resourcesTouchedByWrites,
  isInvalidatedByWrite,
  parseTtlMs,
} from "./store/cache.ts";
export type { CacheTier, CacheEntry, InvalidationEvent, StoreCache } from "./store/cache.ts";

export { isReadOnlyStoreFlow, sqlRoleForEffects, resolveSqlTarget } from "./store/replica.ts";
export type { SqlBindingConfig } from "./store/replica.ts";

export { defineTable, resolveTableName, classificationsFromTable, id, now } from "./store/table.ts";
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

export { createSqlStoreHandle, resolvePkColumn } from "./store/sql-session.ts";
export type {
  SqlStoreHandle,
  SelectBuilder,
  SelectFromBuilder,
  SelectWhereBuilder,
  SelectOrderBuilder,
  InsertBuilder,
  InsertValuesBuilder,
  SqlSessionOptions,
  SqlPageOptions,
  WhereMap,
} from "./store/sql-session.ts";

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

export { fileKeyWarnings, contentAddressedKey, projectFileKeys } from "./store/files-policy.ts";
export type { FileKeyWarning } from "./store/files-policy.ts";

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
