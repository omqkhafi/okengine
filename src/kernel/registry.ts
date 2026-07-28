/**
 * Plugin registry — identity dedup, conflict detection, capability capture.
 *
 * At `.plug()` time the registration function runs against a builder we
 * supply; every method call is recorded. That recording is how the Manifest
 * learns capabilities — never by statically analysing plugin source.
 *
 * Colliding table, panel, or driver names fail the boot naming both sides.
 * Never last-write-wins. Registering the same plugin twice is a no-op;
 * registering it twice with conflicting config is a boot error.
 *
 * @see docs/spec/console.md §9.15
 */

import type { FlowErrorMap } from "./flow.ts";
import type { HookFn, HookMap, HookStage } from "./hooks.ts";
import { tagHookWithPlugin } from "./hook-timing.ts";
import type {
  CliContribution,
  ClientExtensionContribution,
  ConsolePanelContribution,
  DriverContribution,
  ImageRecipeContribution,
  PluginApi,
  PluginCapabilities,
  PluginDef,
  PluginElement,
  PluginRegistration,
  PluginTableOptions,
  TableContribution,
} from "./plugin.ts";
import type { SchemaInput } from "../validation/standard-schema.ts";
import type { AnyFlowDef } from "./flow.ts";

/** Attachment-point scope — the position is the scope. No escape hatch. */
export type PluginScope =
  | { readonly kind: "app" }
  | { readonly kind: "unit"; readonly name: string }
  | { readonly kind: "flow"; readonly name: string };

/** One installed plugin at a scope. */
export interface InstalledPlugin {
  readonly plugin: PluginDef;
  readonly scope: PluginScope;
  readonly registration: PluginRegistration;
}

/** Claim in a conflict namespace. */
interface NameClaim {
  readonly name: string;
  readonly plugin: string;
  readonly kind: "table" | "panel" | "driver";
}

/**
 * Create a recording {@link PluginApi} that captures every contribution.
 *
 * @param identity - Plugin name + version for the capability record
 */
export function createRecordingApi(identity: { readonly name: string; readonly version: string }): {
  readonly api: PluginApi;
  snapshot(): PluginRegistration;
} {
  const hooks: Partial<Record<HookStage, HookFn[]>> = {};
  const decorations: Record<string, unknown> = {};
  const elements: PluginElement[] = [];
  const tables: TableContribution[] = [];
  const drivers: DriverContribution[] = [];
  const panels: ConsolePanelContribution[] = [];
  const cli: CliContribution[] = [];
  const images: ImageRecipeContribution[] = [];
  const flows: AnyFlowDef[] = [];
  const errors: FlowErrorMap = {};
  const client: ClientExtensionContribution[] = [];
  const needs: string[] = [];
  const declares: string[] = [];
  const intercepts: string[] = [];
  let configSchema: SchemaInput | undefined;

  function pushDeclare(cap: string): void {
    if (!declares.includes(cap)) declares.push(cap);
  }

  function pushIntercept(stage: HookStage): void {
    if (!intercepts.includes(stage)) intercepts.push(stage);
  }

  const api: PluginApi = {
    hook(stage, fn) {
      const list = hooks[stage] ?? (hooks[stage] = []);
      // Tag so runPipeline can attribute real wall-clock cost to this plugin.
      list.push(tagHookWithPlugin(identity.name, fn));
      pushIntercept(stage);
      return api;
    },
    decorate(key, value) {
      decorations[key] = value;
      pushDeclare(`decorate:${key}`);
      return api;
    },
    element(element) {
      elements.push(element);
      pushDeclare(`${element.kind}:${element.name}`);
      return api;
    },
    needs(dep) {
      if (!needs.includes(dep)) needs.push(dep);
      return api;
    },
    errors(map) {
      for (const [key, schema] of Object.entries(map)) {
        (errors as Record<string, SchemaInput>)[key] = schema;
        pushDeclare(`errors:${key}`);
      }
      return api;
    },
    consolePanel(panel) {
      panels.push(panel);
      pushDeclare(`consolePanel:${panel.id}`);
      return api;
    },
    cli(name, handler) {
      cli.push({ name, handler });
      pushDeclare(`cli:${name}`);
      return api;
    },
    driver(id, implementation) {
      drivers.push({ id, implementation });
      pushDeclare(`driver:${id}`);
      return api;
    },
    image(role, recipe) {
      images.push({ role, recipe });
      pushDeclare(`image:${role}`);
      return api;
    },
    table(name, columns, options) {
      tables.push(normalizeTableContribution(name, columns, options));
      pushDeclare(`table:${name}`);
      return api;
    },
    flow(flowDef) {
      flows.push(flowDef);
      pushDeclare(`flow:${flowDef.name}`);
      return api;
    },
    client(name, extension) {
      client.push({ name, extension });
      pushDeclare(`client:${name}`);
      return api;
    },
    config(schema) {
      configSchema = schema;
      pushDeclare("config");
      return api;
    },
  };

  return {
    api,
    snapshot(): PluginRegistration {
      return {
        capabilities: {
          name: identity.name,
          version: identity.version,
          declares: declares.slice(),
          intercepts: intercepts.slice(),
          needs: needs.slice(),
        },
        hooks: { ...hooks },
        decorations: { ...decorations },
        elements: elements.slice(),
        tables: tables.slice(),
        drivers: drivers.slice(),
        panels: panels.slice(),
        cli: cli.slice(),
        images: images.slice(),
        flows: flows.slice(),
        errors: { ...errors },
        client: client.slice(),
        configSchema,
      };
    },
  };
}

/**
 * Stable config comparison for identity dedup.
 *
 * @param a - Left
 * @param b - Right
 */
export function samePluginConfig(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === undefined && b === undefined) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Format a scope for error messages. */
function scopeLabel(scope: PluginScope): string {
  if (scope.kind === "app") return "app";
  if (scope.kind === "unit") return `unit:${scope.name}`;
  return `flow:${scope.name}`;
}

/**
 * Plugin registry for one application (or test harness).
 */
export interface PluginRegistry {
  /**
   * Run capability capture and install the plugin at `scope`.
   *
   * @param pluginDef - Plugin to install
   * @param scope - Attachment point
   * @returns The captured registration, or `undefined` when a duplicate no-op
   */
  plug(pluginDef: PluginDef, scope: PluginScope): PluginRegistration | undefined;
  /** All installed plugins (order of first successful plug). */
  readonly installed: readonly InstalledPlugin[];
  /** Manifest-shaped capability map keyed by plugin name. */
  capabilities(): Record<string, PluginCapabilities>;
  /**
   * Plugin hooks for one scope kind that apply to this invocation.
   *
   * @param scopeKind - Attachment kind to collect
   * @param unit - Flow's unit name (for `unit` kind)
   * @param flowName - Flow name (for `flow` kind)
   */
  hooksAt(scopeKind: PluginScope["kind"], unit: string | undefined, flowName: string): HookMap;
  /**
   * Merged decorations visible to a flow at the given unit.
   *
   * @param unit - Flow's unit name, if any
   * @param flowName - Flow name
   */
  decorationsFor(unit: string | undefined, flowName: string): Record<string, unknown>;
  /**
   * Unique table contributions from installed plugins (first install per
   * plugin name). Used by `oke db` emit to merge plugin `field.*` tables.
   */
  tableContributions(): readonly TableContribution[];
}

/**
 * Create an empty plugin registry.
 */
export function createPluginRegistry(): PluginRegistry {
  const installed: InstalledPlugin[] = [];
  /** name → any prior install (config must agree across scopes). */
  const byName = new Map<string, InstalledPlugin>();
  /** name@scope → install (duplicate at the same attachment point is a no-op). */
  const byNameScope = new Map<string, InstalledPlugin>();
  const tableClaims = new Map<string, NameClaim>();
  const panelClaims = new Map<string, NameClaim>();
  const driverClaims = new Map<string, NameClaim>();

  function claim(
    map: Map<string, NameClaim>,
    kind: NameClaim["kind"],
    name: string,
    pluginName: string,
  ): void {
    const existing = map.get(name);
    if (existing && existing.plugin !== pluginName) {
      throw new Error(
        `Plugin conflict: ${kind} "${name}" claimed by "${existing.plugin}" and "${pluginName}"`,
      );
    }
    if (!existing) {
      map.set(name, { name, plugin: pluginName, kind });
    }
  }

  function assertNoConflicts(pluginName: string, registration: PluginRegistration): void {
    for (const t of registration.tables) {
      claim(tableClaims, "table", t.name, pluginName);
    }
    for (const p of registration.panels) {
      claim(panelClaims, "panel", p.id, pluginName);
    }
    for (const d of registration.drivers) {
      claim(driverClaims, "driver", d.id, pluginName);
    }
  }

  function nameScopeKey(name: string, scope: PluginScope): string {
    return `${name}\0${scopeLabel(scope)}`;
  }

  const registry: PluginRegistry = {
    installed,
    plug(pluginDef, scope) {
      const scopeKey = nameScopeKey(pluginDef.name, scope);
      const priorHere = byNameScope.get(scopeKey);
      if (priorHere) {
        if (samePluginConfig(priorHere.plugin.configSnapshot, pluginDef.configSnapshot)) {
          return undefined; // identity dedup — no-op
        }
        throw new Error(
          `Plugin "${pluginDef.name}" registered twice with conflicting config ` +
            `(scope ${scopeLabel(scope)})`,
        );
      }

      const priorAnywhere = byName.get(pluginDef.name);
      if (
        priorAnywhere &&
        !samePluginConfig(priorAnywhere.plugin.configSnapshot, pluginDef.configSnapshot)
      ) {
        throw new Error(
          `Plugin "${pluginDef.name}" registered twice with conflicting config ` +
            `(scopes ${scopeLabel(priorAnywhere.scope)} and ${scopeLabel(scope)})`,
        );
      }

      const { api, snapshot } = createRecordingApi({
        name: pluginDef.name,
        version: pluginDef.version,
      });
      pluginDef.register(api);
      const registration = snapshot();

      // Conflict namespaces are global — only claim on first install of this name.
      if (!priorAnywhere) {
        assertNoConflicts(pluginDef.name, registration);
      }

      const entry: InstalledPlugin = {
        plugin: pluginDef,
        scope,
        registration,
      };
      installed.push(entry);
      byNameScope.set(scopeKey, entry);
      if (!priorAnywhere) byName.set(pluginDef.name, entry);
      return registration;
    },
    capabilities() {
      const out: Record<string, PluginCapabilities> = {};
      for (const entry of installed) {
        // One Manifest entry per plugin name (capabilities are identical).
        out[entry.plugin.name] = entry.registration.capabilities;
      }
      return out;
    },
    hooksAt(scopeKind, unit, flowName) {
      const out: HookMap = {};
      for (const entry of installed) {
        const { scope, registration } = entry;
        if (scope.kind !== scopeKind) continue;
        const applies =
          scope.kind === "app" ||
          (scope.kind === "unit" && unit !== undefined && scope.name === unit) ||
          (scope.kind === "flow" && scope.name === flowName);
        if (!applies) continue;
        for (const [stage, fns] of Object.entries(registration.hooks) as Array<
          [HookStage, HookFn[]]
        >) {
          if (!fns?.length) continue;
          const list = out[stage] ?? (out[stage] = []);
          list.push(...fns);
        }
      }
      return out;
    },
    decorationsFor(unit, flowName) {
      const out: Record<string, unknown> = {};
      for (const entry of installed) {
        const { scope, registration } = entry;
        const applies =
          scope.kind === "app" ||
          (scope.kind === "unit" && unit !== undefined && scope.name === unit) ||
          (scope.kind === "flow" && scope.name === flowName);
        if (!applies) continue;
        Object.assign(out, registration.decorations);
      }
      return out;
    },
    tableContributions() {
      const seenPlugins = new Set<string>();
      const out: TableContribution[] = [];
      for (const entry of installed) {
        if (seenPlugins.has(entry.plugin.name)) continue;
        seenPlugins.add(entry.plugin.name);
        out.push(...entry.registration.tables);
      }
      return out;
    },
  };

  return registry;
}

/**
 * Normalize plugin `.table()` args — supports columns + options, and legacy
 * `{ plane }` as the second argument.
 *
 * @param name - Table name
 * @param columnsOrOptions - Column map or legacy options
 * @param options - Explicit options (preferred)
 */
function normalizeTableContribution(
  name: string,
  columnsOrOptions?: Readonly<Record<string, unknown>>,
  options?: PluginTableOptions,
): TableContribution {
  if (options !== undefined) {
    const columns =
      columnsOrOptions && Object.keys(columnsOrOptions).length > 0 ? columnsOrOptions : undefined;
    return {
      name,
      ...(columns ? { columns } : {}),
      options,
      schema: options,
    };
  }

  if (columnsOrOptions && isPlaneOnlyOptions(columnsOrOptions)) {
    const planeOptions: PluginTableOptions = {
      plane: columnsOrOptions.plane as string,
    };
    return {
      name,
      options: planeOptions,
      schema: columnsOrOptions,
    };
  }

  if (columnsOrOptions && Object.keys(columnsOrOptions).length > 0) {
    return {
      name,
      columns: columnsOrOptions,
      schema: columnsOrOptions,
    };
  }

  return { name };
}

function isPlaneOnlyOptions(
  value: Readonly<Record<string, unknown>>,
): value is { readonly plane: string } {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "plane" && typeof value.plane === "string";
}
