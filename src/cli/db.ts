/**
 * `oke db push|generate|migrate` — domain schema sync via drizzle-kit.
 *
 * Distinct from `oke schema generate` (core/plugin stub tables).
 * When abstract decls exist (`src/schema.decl.ts`), emits Drizzle first —
 * not a third schema CLI.
 */

import { resolve } from "node:path";
import {
  dialectFromDriverId,
  maybeEmitDomainSchema,
  type SqlDialect,
} from "../elements/store/emit-drizzle.ts";
import { loadPluginTablesFromAppEntry } from "../elements/store/load-plugin-tables.ts";
import { resolveDriverId, type ConfigEnv, type OkeConfig } from "../config/index.ts";
import type { TableContribution } from "../kernel/plugin.ts";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit.ts";
import { loadOkeConfig } from "./load-config.ts";

/** Subcommands under `oke db`. */
export type DbSubcommand = "push" | "generate" | "migrate";

/** Options for {@link runDb}. */
export interface DbOptions {
  readonly cwd?: string;
  /** Path to drizzle.config.ts (overrides `db.config`). */
  readonly config?: string;
  readonly write?: (text: string) => void;
  /** Injectable push (tests). */
  readonly pushFn?: (opts: { config: string }) => Promise<DbKitResult>;
  /** Injectable generate (tests). */
  readonly generateFn?: (opts: {
    config: string;
  }) => Promise<DbKitResult & { readonly migration_path?: string }>;
  /** Injectable migrate (tests). */
  readonly migrateFn?: (opts: { config: string; cwd: string }) => Promise<number>;
  /**
   * Dry-run push via drizzle-kit `explain` — used by doctor drift checks.
   */
  readonly explain?: boolean;
  /**
   * Skip abstract-schema emit pre-step (tests / explain-only).
   */
  readonly skipEmit?: boolean;
  /** Active config env for dialect resolution (default `local`). */
  readonly env?: ConfigEnv;
  /**
   * Injectable plugin tables for emit (tests). When omitted, loads the live
   * app entry and reads `app.plugins.tableContributions()`.
   */
  readonly pluginTables?: readonly TableContribution[];
  /** Override app entry path for plugin-table discovery. */
  readonly entry?: string;
}

/** Minimal drizzle-kit envelope we handle. */
export interface DbKitResult {
  readonly status: "ok" | "no_changes" | "missing_hints" | "error" | string;
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly unresolved?: readonly unknown[];
}

/**
 * Resolve the drizzle config path for a project.
 *
 * @param cwd - Project root
 * @param options - CLI / config overrides
 */
export async function resolveDrizzleConfigPath(
  cwd: string,
  options: {
    readonly config?: string;
    readonly loadedConfig?: OkeConfig | null;
  } = {},
): Promise<string> {
  if (options.config) return resolve(cwd, options.config);
  const loaded = options.loadedConfig ?? (await loadOkeConfig(cwd).catch(() => null))?.config;
  const fromConfig = loaded?.db?.config;
  return resolve(cwd, fromConfig ?? "drizzle.config.ts");
}

/**
 * Run `oke db <subcommand>`.
 *
 * @param sub - push | generate | migrate
 * @param options - Paths / injectables
 */
export async function runDb(sub: DbSubcommand, options: DbOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  if (!options.skipEmit) {
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, options.env ?? "local", {
      pluginTables: options.pluginTables,
      entry: options.entry,
    });
  }
  const configPath = await resolveDrizzleConfigPath(cwd, {
    config: options.config,
    loadedConfig: loaded?.config,
  });

  if (sub === "push") {
    return runPush(configPath, write, { ...options, skipEmit: true });
  }
  if (sub === "generate") {
    return runGenerate(configPath, write, { ...options, skipEmit: true });
  }
  if (sub === "migrate") {
    return runMigrate(configPath, cwd, write, { ...options, skipEmit: true });
  }
  write(`oke db: unknown subcommand\n`);
  return EXIT_USAGE;
}

/**
 * Emit `schema.generated.ts` from abstract decls + live plugged plugin tables.
 *
 * @param cwd - Project root
 * @param config - Loaded oke config
 * @param write - Output
 * @param env - Active env for dialect
 * @param options - Injectables / entry override
 */
export async function emitAbstractSchemaPrestep(
  cwd: string,
  config: OkeConfig | null | undefined,
  write: (text: string) => void = () => {},
  env: ConfigEnv = "local",
  options: {
    readonly pluginTables?: readonly TableContribution[];
    readonly entry?: string;
  } = {},
): Promise<boolean> {
  const driverId = resolveDriverId(config?.drivers?.store?.sql, env);
  const dialect: SqlDialect = dialectFromDriverId(driverId);
  const pluginTables =
    options.pluginTables ??
    (await loadPluginTablesFromAppEntry(cwd, {
      entry: options.entry ?? config?.db?.entry,
      write,
    }));
  const result = await maybeEmitDomainSchema({
    cwd,
    dialect,
    declarePath: config?.db?.declare,
    outPath: config?.db?.generated,
    pluginTables,
    write,
  });
  return result.emitted;
}

/**
 * Push domain schema to the live database (dev).
 *
 * @param configPath - Absolute drizzle.config.ts
 * @param write - Output
 * @param options - Injectables / explain
 */
export async function runPush(
  configPath: string,
  write: (text: string) => void = (t) => process.stdout.write(t),
  options: DbOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  if (!options.skipEmit) {
    const loaded = await loadOkeConfig(cwd).catch(() => null);
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, options.env ?? "local", {
      pluginTables: options.pluginTables,
      entry: options.entry,
    });
  }

  const pushFn =
    options.pushFn ??
    (async (opts: { config: string }) => {
      const { push } = await import("drizzle-kit/cli");
      return (await push({
        config: opts.config,
        ...(options.explain ? { explain: true } : {}),
      })) as DbKitResult;
    });

  let result: DbKitResult;
  try {
    result = await pushFn({ config: configPath });
  } catch (err) {
    write(`oke db push: ${err instanceof Error ? err.message : String(err)}\n`);
    write("         → install drizzle-kit and ensure drizzle.config.ts exists\n");
    return EXIT_RUNTIME;
  }

  return reportKitResult("push", result, write);
}

/**
 * Generate versioned migration SQL under `out` (prod artefact folder).
 *
 * @param configPath - Absolute drizzle.config.ts
 * @param write - Output
 * @param options - Injectables
 */
export async function runGenerate(
  configPath: string,
  write: (text: string) => void = (t) => process.stdout.write(t),
  options: DbOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  if (!options.skipEmit) {
    const loaded = await loadOkeConfig(cwd).catch(() => null);
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, options.env ?? "local", {
      pluginTables: options.pluginTables,
      entry: options.entry,
    });
  }

  const generateFn =
    options.generateFn ??
    (async (opts: { config: string }) => {
      const { generate } = await import("drizzle-kit/cli");
      return (await generate({ config: opts.config })) as DbKitResult & {
        readonly migration_path?: string;
      };
    });

  let result: DbKitResult & { readonly migration_path?: string };
  try {
    result = await generateFn({ config: configPath });
  } catch (err) {
    write(`oke db generate: ${err instanceof Error ? err.message : String(err)}\n`);
    write("         → install drizzle-kit and ensure drizzle.config.ts exists\n");
    return EXIT_RUNTIME;
  }

  if (result.status === "ok" && result.migration_path) {
    write(`oke db generate: wrote ${result.migration_path}\n`);
    return EXIT_OK;
  }
  return reportKitResult("generate", result, write);
}

/**
 * Apply versioned migrations (`drizzle-kit migrate`).
 *
 * @param configPath - Absolute drizzle.config.ts
 * @param cwd - Project root
 * @param write - Output
 * @param options - Injectables
 */
export async function runMigrate(
  configPath: string,
  cwd: string,
  write: (text: string) => void = (t) => process.stdout.write(t),
  options: DbOptions = {},
): Promise<number> {
  if (!options.skipEmit) {
    const loaded = await loadOkeConfig(cwd).catch(() => null);
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, options.env ?? "local", {
      pluginTables: options.pluginTables,
      entry: options.entry,
    });
  }

  const migrateFn =
    options.migrateFn ??
    (async (opts: { config: string; cwd: string }) => {
      const proc = Bun.spawn(["bunx", "drizzle-kit", "migrate", "--config", opts.config], {
        cwd: opts.cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: process.env as Record<string, string>,
      });
      return await proc.exited;
    });

  try {
    const code = await migrateFn({ config: configPath, cwd });
    if (code === 0) {
      write("oke db migrate: applied\n");
      return EXIT_OK;
    }
    write(`oke db migrate: exited ${code}\n`);
    return EXIT_RUNTIME;
  } catch (err) {
    write(`oke db migrate: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_RUNTIME;
  }
}

/**
 * Whether domain schema differs from the live DB (drizzle-kit push explain).
 *
 * @param options - Paths / injectables
 */
export async function detectDbDrift(options: DbOptions = {}): Promise<{
  readonly drifted: boolean;
  readonly detail?: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = await resolveDrizzleConfigPath(cwd, { config: options.config });
  const pushFn =
    options.pushFn ??
    (async (opts: { config: string }) => {
      const { push } = await import("drizzle-kit/cli");
      return (await push({ config: opts.config, explain: true })) as DbKitResult;
    });

  try {
    const result = await pushFn({ config: configPath });
    if (result.status === "no_changes") return { drifted: false };
    if (result.status === "ok" || result.status === "missing_hints") {
      return { drifted: true, detail: `drizzle-kit push explain: ${result.status}` };
    }
    if (result.status === "error") {
      return {
        drifted: false,
        detail: result.error?.message ?? "drizzle-kit push explain failed",
      };
    }
    return { drifted: false };
  } catch (err) {
    return {
      drifted: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * CLI entry: parse `oke db <push|generate|migrate> [--config path]`.
 *
 * @param args - Args after `db`
 */
export async function dbCli(args: readonly string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`oke db push|generate|migrate [--config|-c drizzle.config.ts]

Domain schema sync via drizzle-kit.
When src/schema.decl.ts and/or a plugged app entry exists, emits
schema.generated.ts from store.schema.table + live plugin .table()
contributions — then runs drizzle-kit.
Hand-written src/schema.ts remains supported (emit skipped if nothing to emit).
Not the same as \`oke schema generate\` (core/plugin stub tables).

  push       Apply schema to the live local DB (dev; no migration files)
  generate   Write versioned SQL under drizzle/ for review
  migrate    Apply generated migrations (explicit; never automatic in prod)
`);
    return sub ? EXIT_OK : EXIT_USAGE;
  }
  if (sub !== "push" && sub !== "generate" && sub !== "migrate") {
    console.error(`oke db: unknown subcommand "${sub}"`);
    return EXIT_USAGE;
  }

  let config: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--config" || a === "-c") config = args[++i];
    else if (a === "--help" || a === "-h") {
      return dbCli(["--help"]);
    }
  }

  return runDb(sub, { config });
}

function reportKitResult(verb: string, result: DbKitResult, write: (text: string) => void): number {
  if (result.status === "ok" || result.status === "no_changes") {
    write(`oke db ${verb}: ${result.status}\n`);
    return EXIT_OK;
  }
  if (result.status === "missing_hints") {
    write(
      `oke db ${verb}: missing_hints — resolve destructive changes manually (not auto-applied)\n`,
    );
    return EXIT_RUNTIME;
  }
  write(
    `oke db ${verb}: ${result.status}${result.error?.message ? ` — ${result.error.message}` : ""}\n`,
  );
  return EXIT_RUNTIME;
}
