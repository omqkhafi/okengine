/**
 * Store panel view types (console §9.5).
 */

/** Store facet. */
export type StoreFacet = "sql" | "kv" | "files" | "index";

/** Will-not-fire payload for a direct edit confirmation. */
export interface WillNotFire {
  readonly writerFlowIds: readonly string[];
  readonly signals: readonly string[];
  readonly channels: readonly string[];
}

/** Cache sub-view for one child resource. */
export interface StoreCacheView {
  readonly producedByRead: string;
  readonly invalidatedByWrites: readonly string[];
  readonly invalidatingFlowIds: readonly string[];
}

/** Child resource under a store. */
export interface StoreChild {
  readonly name: string;
  readonly effectRef: string;
  readonly writers: readonly string[];
  readonly readers: readonly string[];
  readonly cache: StoreCacheView;
  readonly willNotFire: WillNotFire;
  readonly piiColumns: readonly string[];
  readonly columnDescriptions: Readonly<Record<string, string>>;
}

/** One store row from `console.store.list`. */
export interface StoreRecord {
  readonly ref: string;
  readonly facet: StoreFacet;
  readonly name: string;
  readonly description?: string;
  readonly children: readonly StoreChild[];
  readonly replicaLagMs: number | null;
  readonly migrationDrift: {
    readonly declared: string;
    readonly applied: string | null;
    readonly drifted: boolean;
  } | null;
  readonly contentAddressed: boolean;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly key: string;
  }>;
}

/** Facet group for the list. */
export interface StoreFacetGroup {
  readonly facet: StoreFacet;
  readonly label: string;
  readonly stores: readonly StoreRecord[];
}

/** List response envelope. */
export interface StoreListResponse {
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
  readonly stores: readonly StoreRecord[];
}
