/**
 * `plugin(name, { version })` — the extensibility builder.
 *
 * A plugin is a registration plan. Fluent methods queue contributions; at
 * `.plug()` time the registry runs that plan against a builder it supplies
 * and records exactly what was requested (capability capture). We never
 * statically analyse plugin source to guess intent.
 *
 * Contributions: flows · hooks · edge handlers (unmatched requests) ·
 * context decorations · elements · drivers · image recipes · DB schema ·
 * typed errors · client extensions · CLI commands · Console panels.
 *
 * @see docs/spec/unified-theory.md §14
 * @see docs/spec/console.md §9.15
 */

import type { SchemaInput } from "../validation/standard-schema.ts";
import type { AnyFlowDef, FlowErrorMap } from "./flow.ts";
import type { HookFn, HookStage } from "./hooks.ts";

/** Brand carrying accumulated decoration types through the builder. */
declare const pluginDecorations: unique symbol;

/** Identity + version for a plugin definition. */
export interface PluginIdentity {
  /** Stable plugin id (Manifest key). */
  readonly name: string;
  /** Semver string recorded in the Manifest. */
  readonly version: string;
  /**
   * Optional config snapshot used for identity dedup.
   * Same name + same config → no-op; same name + different config → boot error.
   */
  readonly config?: unknown;
}

/** Options for {@link plugin}. */
export interface PluginOptions {
  /** Semver string recorded in the Manifest. */
  readonly version: string;
  /**
   * Optional config snapshot for identity dedup when the same plugin is
   * plugged more than once (e.g. `rateLimit({ max: 30 })`).
   */
  readonly config?: unknown;
}

/** Element contribution (store, signal, …) — opaque until elements ship. */
export interface PluginElement {
  /** Protocol / facet kind (e.g. `"store.sql"`). */
  readonly kind: string;
  /** Element name within that kind (e.g. `"audit"`). */
  readonly name: string;
}

/** Console panel contribution. */
export interface ConsolePanelContribution {
  /** Panel id — conflict namespace shared across plugins. */
  readonly id: string;
  /** Display title. */
  readonly title: string;
  /** ESM entry path loaded at runtime by the Console. */
  readonly entry: string;
}

/** CLI command contribution. */
export interface CliContribution {
  /** Command name (e.g. `"audit:export"`). */
  readonly name: string;
  /** Handler invoked by the CLI. */
  readonly handler: (args: { readonly fx: unknown }) => unknown;
}

/** Client extension contribution. */
export interface ClientExtensionContribution {
  /** Extension id. */
  readonly name: string;
  /** Opaque extension payload. */
  readonly extension: unknown;
}

/** Image recipe contribution (role → recipe id). */
export interface ImageRecipeContribution {
  /** Image role (e.g. `"store.sql"`). */
  readonly role: string;
  /** Recipe identifier or descriptor. */
  readonly recipe: string;
}

/**
 * Edge handler — runs for HTTP requests that match **no** flow (the prime
 * example: a CORS preflight `OPTIONS` for a path bound to another method).
 * Handlers run in install order; the first to return a {@link Response}
 * answers, `undefined` passes to the next handler, then the plain 404.
 */
export type EdgeHandler = (
  request: Request,
  info: { readonly method: string; readonly path: string },
) => undefined | Response | Promise<undefined | Response>;

/** Table / DB schema contribution. */
export interface TableContribution {
  /** Table name — conflict namespace shared across plugins. */
  readonly name: string;
  /**
   * Abstract column map from `field.*` builders (merged into domain schema emit).
   * Omit when the plugin only claims a name (DDL stays hand-written).
   */
  readonly columns?: Readonly<Record<string, unknown>>;
  /**
   * Non-column metadata (e.g. data plane). Prefer this over stuffing `plane`
   * into the column map.
   */
  readonly options?: {
    readonly plane?: "operator" | "user" | "shared" | string;
  };
  /**
   * Opaque schema descriptor (legacy). Prefer {@link columns} + {@link options}.
   * Still set for plane-only contributions so older readers keep working.
   */
  readonly schema?: unknown;
}

/** Options for {@link PluginApi.table} / {@link PluginDef.table}. */
export interface PluginTableOptions {
  readonly plane?: "operator" | "user" | "shared" | string;
}

/** Driver contribution. */
export interface DriverContribution {
  /** Driver id (protocol-named) — conflict namespace shared across plugins. */
  readonly id: string;
  /** Opaque driver implementation / factory. */
  readonly implementation?: unknown;
}

/**
 * Builder surface supplied at boot for capability capture.
 * Method calls are the source of truth for Manifest capabilities.
 */
export interface PluginApi {
  /**
   * Register a hook (intercept — per request).
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): PluginApi;
  /**
   * Register an edge handler (intercept — requests that match no flow).
   *
   * @param fn - Edge handler
   */
  edge(fn: EdgeHandler): PluginApi;
  /**
   * Decorate the invocation context (declare — once at boot).
   *
   * @param key - Decoration key
   * @param value - Value visible to handlers in scope
   */
  decorate(key: string, value: unknown): PluginApi;
  /**
   * Contribute an element.
   *
   * @param element - Kind + name
   */
  element(element: PluginElement): PluginApi;
  /**
   * Declare a runtime dependency on another capability.
   *
   * @param dep - Dependency id (e.g. `"store.kv"`)
   */
  needs(dep: string): PluginApi;
  /**
   * Contribute typed errors.
   *
   * @param errors - Error name → schema
   */
  errors(errors: FlowErrorMap): PluginApi;
  /**
   * Contribute a Console panel.
   *
   * @param panel - Panel descriptor
   */
  consolePanel(panel: ConsolePanelContribution): PluginApi;
  /**
   * Contribute a CLI command.
   *
   * @param name - Command name
   * @param handler - Command handler
   */
  cli(name: string, handler: CliContribution["handler"]): PluginApi;
  /**
   * Contribute a driver.
   *
   * @param id - Protocol-named driver id
   * @param implementation - Driver impl
   */
  driver(id: string, implementation?: unknown): PluginApi;
  /**
   * Contribute an image recipe for a role.
   *
   * @param role - Image role
   * @param recipe - Recipe id
   */
  image(role: string, recipe: string): PluginApi;
  /**
   * Contribute a DB table / schema fragment.
   *
   * Plugins may declare **whole tables** (with optional `field.*` columns)
   * merged into the generated domain schema. Extending an existing app-owned
   * table with plugin columns is not supported — contribute a separate table.
   *
   * @param name - Table name
   * @param columns - Abstract column map, or legacy `{ plane }` options
   * @param options - Plane / metadata (preferred over embedding `plane` in columns)
   */
  table(
    name: string,
    columns?: Readonly<Record<string, unknown>>,
    options?: PluginTableOptions,
  ): PluginApi;
  /**
   * Contribute a flow.
   *
   * @param flowDef - Flow definition
   */
  flow(flowDef: AnyFlowDef): PluginApi;
  /**
   * Contribute a typed client extension.
   *
   * @param name - Extension id
   * @param extension - Opaque extension
   */
  client(name: string, extension: unknown): PluginApi;
  /**
   * Attach a config schema (declare shape; values live on identity.config).
   *
   * @param schema - Standard Schema
   */
  config(schema: SchemaInput): PluginApi;
}

/** Captured capability lists for the Manifest. */
export interface PluginCapabilities {
  /** Plugin id. */
  readonly name: string;
  /** Plugin version. */
  readonly version: string;
  /** Boot-time declarations (schema, elements, drivers, panels, CLI, …). */
  readonly declares: readonly string[];
  /** Per-request intercepts (hook stages). */
  readonly intercepts: readonly string[];
  /** Declared dependencies from `.needs()`. */
  readonly needs: readonly string[];
}

/** Snapshot of everything a registration requested. */
export interface PluginRegistration {
  readonly capabilities: PluginCapabilities;
  readonly hooks: Partial<Record<HookStage, HookFn[]>>;
  readonly edges: readonly EdgeHandler[];
  readonly decorations: Readonly<Record<string, unknown>>;
  readonly elements: readonly PluginElement[];
  readonly tables: readonly TableContribution[];
  readonly drivers: readonly DriverContribution[];
  readonly panels: readonly ConsolePanelContribution[];
  readonly cli: readonly CliContribution[];
  readonly images: readonly ImageRecipeContribution[];
  readonly flows: readonly AnyFlowDef[];
  readonly errors: FlowErrorMap;
  readonly client: readonly ClientExtensionContribution[];
  readonly configSchema: SchemaInput | undefined;
}

/**
 * A plugin definition — identity plus a registration function.
 *
 * @typeParam D - Accumulated decoration types from `.decorate()`
 */
export interface PluginDef<D extends Record<string, unknown> = {}> {
  readonly [pluginDecorations]?: D;
  /** Plugin name. */
  readonly name: string;
  /** Plugin version. */
  readonly version: string;
  /**
   * Config snapshot for identity dedup (from {@link PluginOptions.config}).
   * Distinct from the fluent `.config(schema)` method.
   */
  readonly configSnapshot: unknown;
  /**
   * Registration function. The registry calls this with a builder and
   * records every method invoked — that recording is the capability list.
   *
   * @param api - Builder supplied by the registry
   */
  register(api: PluginApi): void;
  /**
   * Queue a hook contribution.
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): PluginDef<D>;
  /**
   * Queue an edge handler contribution (requests that match no flow).
   *
   * @param fn - Edge handler
   */
  edge(fn: EdgeHandler): PluginDef<D>;
  /**
   * Queue a context decoration. Accumulates types for `.plug()`.
   *
   * @param key - Decoration key
   * @param value - Value
   */
  decorate<K extends string, V>(key: K, value: V): PluginDef<D & { [P in K]: V }>;
  /**
   * Queue an element contribution.
   *
   * @param element - Element descriptor
   */
  element(element: PluginElement): PluginDef<D>;
  /**
   * Queue a dependency declaration.
   *
   * @param dep - Dependency id
   */
  needs(dep: string): PluginDef<D>;
  /**
   * Queue typed errors.
   *
   * @param errors - Error map
   */
  errors(errors: FlowErrorMap): PluginDef<D>;
  /**
   * Queue a Console panel.
   *
   * @param panel - Panel descriptor
   */
  consolePanel(panel: ConsolePanelContribution): PluginDef<D>;
  /**
   * Queue a CLI command.
   *
   * @param name - Command name
   * @param handler - Handler
   */
  cli(name: string, handler: CliContribution["handler"]): PluginDef<D>;
  /**
   * Queue a driver.
   *
   * @param id - Driver id
   * @param implementation - Impl
   */
  driver(id: string, implementation?: unknown): PluginDef<D>;
  /**
   * Queue an image recipe.
   *
   * @param role - Role
   * @param recipe - Recipe id
   */
  image(role: string, recipe: string): PluginDef<D>;
  /**
   * Queue a table / schema contribution.
   *
   * Whole tables only — no column injection into app-owned tables (v1).
   *
   * @param name - Table name
   * @param columns - Abstract column map, or legacy `{ plane }` options
   * @param options - Plane / metadata
   */
  table(
    name: string,
    columns?: Readonly<Record<string, unknown>>,
    options?: PluginTableOptions,
  ): PluginDef<D>;
  /**
   * Queue a flow contribution.
   *
   * @param flowDef - Flow
   */
  flow(flowDef: AnyFlowDef): PluginDef<D>;
  /**
   * Queue a client extension.
   *
   * @param name - Extension id
   * @param extension - Payload
   */
  client(name: string, extension: unknown): PluginDef<D>;
  /**
   * Queue a config schema.
   *
   * @param schema - Standard Schema
   */
  config(schema: SchemaInput): PluginDef<D>;
}

/** Extract accumulated decoration types from a {@link PluginDef}. */
export type DecorationsOf<P> = P extends PluginDef<infer D> ? D : Record<string, never>;

/**
 * Define a plugin. Fluent methods queue a registration plan; the registry
 * executes that plan at `.plug()` time for capability capture.
 *
 * @param name - Stable plugin id
 * @param options - Version and optional config snapshot
 */
export function plugin(name: string, options: PluginOptions): PluginDef {
  const steps: Array<(api: PluginApi) => void> = [];

  const def: PluginDef = {
    name,
    version: options.version,
    configSnapshot: options.config,
    register(api) {
      for (const step of steps) step(api);
    },
    hook(stage, fn) {
      steps.push((api) => {
        api.hook(stage, fn);
      });
      return def;
    },
    edge(fn) {
      steps.push((api) => {
        api.edge(fn);
      });
      return def;
    },
    decorate(key, value) {
      steps.push((api) => {
        api.decorate(key, value);
      });
      // Decoration accumulate on the interface; runtime object is unchanged.
      return def as never;
    },
    element(element) {
      steps.push((api) => {
        // Accept StoreDecl-like `{ facet, name }` from `store.sql(...)`.
        const el = element as PluginElement & {
          readonly facet?: string;
          readonly name?: string;
        };
        if (el.kind && el.name) {
          api.element(el);
        } else if (typeof el.facet === "string" && typeof el.name === "string") {
          api.element({
            kind: el.facet.startsWith("store.") ? el.facet : `store.${el.facet}`,
            name: el.name,
          });
        } else {
          api.element(el as PluginElement);
        }
      });
      return def;
    },
    needs(dep) {
      steps.push((api) => {
        api.needs(dep);
      });
      return def;
    },
    errors(errors) {
      steps.push((api) => {
        api.errors(errors);
      });
      return def;
    },
    consolePanel(panel) {
      steps.push((api) => {
        api.consolePanel(panel);
      });
      return def;
    },
    cli(cliName, handler) {
      steps.push((api) => {
        api.cli(cliName, handler);
      });
      return def;
    },
    driver(id, implementation) {
      steps.push((api) => {
        api.driver(id, implementation);
      });
      return def;
    },
    image(role, recipe) {
      steps.push((api) => {
        api.image(role, recipe);
      });
      return def;
    },
    table(tableName, columns, options) {
      steps.push((api) => {
        api.table(tableName, columns, options);
      });
      return def;
    },
    flow(flowDef) {
      steps.push((api) => {
        api.flow(flowDef);
      });
      return def;
    },
    client(clientName, extension) {
      steps.push((api) => {
        api.client(clientName, extension);
      });
      return def;
    },
    config(schema) {
      steps.push((api) => {
        api.config(schema);
      });
      return def;
    },
  };

  return def;
}

/**
 * Type guard for {@link PluginDef}.
 *
 * @param value - Unknown
 */
export function isPlugin(value: unknown): value is PluginDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "version" in value &&
    "register" in value &&
    typeof (value as PluginDef).register === "function" &&
    typeof (value as PluginDef).name === "string" &&
    typeof (value as PluginDef).version === "string"
  );
}
