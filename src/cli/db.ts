/**
 * `oke db push|generate|migrate|seed` — domain schema sync via drizzle-kit,
 * plus explicit seed runs.
 *
 * Distinct from `oke schema generate` (core/plugin stub tables).
 * When abstract decls exist (`src/db/schema.decl.ts`), emits Drizzle first —
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
import { runSeed, type SeedOptions } from "./db-seed.ts";
import { installOkeRlsHelpers as runOkeRlsHelperStatements } from "../drivers/pg-rls.ts";
import { resolveDrizzleKitEnv } from "./drizzle-env.ts";
import { resolveDevSqlEnv } from "./resolve-dev-sql-env.ts";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit.ts";
import { loadOkeConfig } from "./load-config.ts";

export {
  executeSeedDef,
  formatSeedTarget,
  isSeedDef,
  loadSeedDef,
  redactConnectionTarget,
  runSeed,
  runSeedFns,
  type SeedOptions,
  type SeedTally,
} from "./db-seed.ts";

/**
 * Apply a drizzle-kit env overlay to `process.env` for the in-process SDK,
 * returning a restore function. drizzle-kit's `push`/`generate` read
 * `process.env` directly (the project `drizzle.config.ts` also reads it), so
 * CLI-resolved dialect + connection env must be present in this process.
 *
 * @param overlay - Env keys to set
 */
export function applyDrizzleEnvOverlay(overlay: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overlay)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/**
 * Resolve env + apply the drizzle-kit overlay for the in-process SDK.
 * Restores the env afterward via a `finally`.
 *
 * @param cwd - Project root
 * @param config - Loaded oke config
 * @param env - Active env
 * @param fn - Work to run under the overlay
 */
export async function withDrizzleKitEnv<T>(
  cwd: string,
  config: OkeConfig | null | undefined,
  env: ConfigEnv,
  fn: (dialect: string) => Promise<T>,
): Promise<T> {
  const { dialect, overlay } = await resolveDrizzleKitEnv(cwd, config, env);
  const restore = applyDrizzleEnvOverlay(overlay);
  try {
    return await fn(dialect);
  } finally {
    restore();
  }
}

/** Subcommands under `oke db`. */
export type DbSubcommand = "push" | "generate" | "migrate" | "seed" | "studio";

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
  readonly migrateFn?: (opts: {
    config: string;
    cwd: string;
    env: Record<string, string>;
  }) => Promise<number>;
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
  /** Skip docker/prod confirm for seed (`--force`). */
  readonly force?: boolean;
  /** Seed module path override. */
  readonly seedPath?: string;
  /** Seed-only injectables forwarded to {@link runSeed}. */
  readonly seedDef?: SeedOptions["seedDef"];
  readonly createFx?: SeedOptions["createFx"];
  readonly confirmEnv?: SeedOptions["confirmEnv"];
  readonly stdinIsTTY?: boolean;
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
 * @param sub - push | generate | migrate | seed
 * @param options - Paths / injectables
 */
export async function runDb(sub: DbSubcommand, options: DbOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const env = options.env ?? (await resolveDevSqlEnv(cwd));

  if (sub === "studio") {
    return runStudio(cwd, options, write, env, loaded?.config ?? null);
  }

  if (sub === "seed") {
    return runSeed({
      cwd,
      write,
      env,
      force: options.force,
      seedPath: options.seedPath,
      entry: options.entry,
      seedDef: options.seedDef,
      createFx: options.createFx,
      confirmEnv: options.confirmEnv,
      stdinIsTTY: options.stdinIsTTY,
    });
  }

  if (!options.skipEmit) {
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, env, {
      pluginTables: options.pluginTables,
      entry: options.entry,
    });
  }
  const configPath = await resolveDrizzleConfigPath(cwd, {
    config: options.config,
    loadedConfig: loaded?.config,
  });
  const resolved = { ...options, skipEmit: true, env };

  if (sub === "push") {
    return runPush(configPath, write, resolved);
  }
  if (sub === "generate") {
    return runGenerate(configPath, write, resolved);
  }
  if (sub === "migrate") {
    return runMigrate(configPath, cwd, write, resolved);
  }
  write(`oke db: unknown subcommand\n`);
  return EXIT_USAGE;
}

/**
 * Emit `schema.drizzle.ts` from abstract decls + live plugged plugin tables.
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
  env: ConfigEnv = "test",
  options: {
    readonly pluginTables?: readonly TableContribution[];
    readonly entry?: string;
  } = {},
): Promise<boolean> {
  // System stubs (core / auth / Manifest stores) — separate from domain Drizzle.
  // Re-run here so plugins added later refresh `.oke/schema/oke.ts` on db push.
  await refreshSystemSchema(cwd, write);

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
 * Quietly refresh `.oke/schema/oke.ts` (never fails the domain db path).
 *
 * @param cwd - Project root
 * @param write - Optional log sink
 */
async function refreshSystemSchema(
  cwd: string,
  write: (text: string) => void = () => {},
): Promise<void> {
  try {
    const { runSchemaGenerate } = await import("./schema.ts");
    await runSchemaGenerate({ cwd, write: () => {} });
  } catch (err) {
    write(`oke schema generate: skipped — ${err instanceof Error ? err.message : String(err)}\n`);
  }
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
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const env = options.env ?? (await resolveDevSqlEnv(cwd));
  if (!options.skipEmit) {
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, env, {
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
    result = await withDrizzleKitEnv(cwd, loaded?.config, env, async () => {
      await installOkeRlsHelpers(write);
      return pushFn({ config: configPath });
    });
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
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const env = options.env ?? (await resolveDevSqlEnv(cwd));
  if (!options.skipEmit) {
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, env, {
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
    result = await withDrizzleKitEnv(cwd, loaded?.config, env, () =>
      generateFn({ config: configPath }),
    );
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
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const env = options.env ?? (await resolveDevSqlEnv(cwd));
  if (!options.skipEmit) {
    await emitAbstractSchemaPrestep(cwd, loaded?.config, write, env, {
      pluginTables: options.pluginTables,
      entry: options.entry,
    });
  }

  const migrateFn =
    options.migrateFn ??
    (async (opts: { config: string; cwd: string; env: Record<string, string> }) => {
      const proc = Bun.spawn(["bunx", "drizzle-kit", "migrate", "--config", opts.config], {
        cwd: opts.cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: opts.env,
      });
      return await proc.exited;
    });

  const { overlay } = await resolveDrizzleKitEnv(cwd, loaded?.config, env);
  const restore = applyDrizzleEnvOverlay(overlay);
  try {
    await installOkeRlsHelpers(write);
    const code = await migrateFn({
      config: configPath,
      cwd,
      env: { ...(process.env as Record<string, string>), ...overlay },
    });
    if (code === 0) {
      write("oke db migrate: applied\n");
      return EXIT_OK;
    }
    write(`oke db migrate: exited ${code}\n`);
    return EXIT_RUNTIME;
  } catch (err) {
    write(`oke db migrate: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_RUNTIME;
  } finally {
    restore();
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
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const env = options.env ?? (await resolveDevSqlEnv(cwd));
  const configPath = await resolveDrizzleConfigPath(cwd, { config: options.config });
  const pushFn =
    options.pushFn ??
    (async (opts: { config: string }) => {
      const { push } = await import("drizzle-kit/cli");
      return (await push({ config: opts.config, explain: true })) as DbKitResult;
    });

  try {
    const result = await withDrizzleKitEnv(cwd, loaded?.config, env, () =>
      pushFn({ config: configPath }),
    );
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
 * Open drizzle-kit Studio against the project config / env overlay.
 *
 * @param cwd - Project root
 * @param options - Paths / injectables
 * @param write - stdout writer
 * @param env - Config env
 * @param config - Loaded oke config
 */
export async function runStudio(
  cwd: string,
  options: DbOptions,
  write: (text: string) => void = (t) => process.stdout.write(t),
  env?: ConfigEnv,
  config?: OkeConfig | null,
): Promise<number> {
  const activeEnv = env ?? (await resolveDevSqlEnv(cwd));
  const loaded = config ?? (await loadOkeConfig(cwd).catch(() => null))?.config ?? null;
  const configPath = await resolveDrizzleConfigPath(cwd, {
    config: options.config,
    loadedConfig: loaded,
  });
  if (!(await Bun.file(configPath).exists())) {
    write(`oke db studio: missing ${configPath}\n`);
    return EXIT_RUNTIME;
  }
  write(`oke db studio: opening drizzle-kit studio (${configPath})\n`);
  return withDrizzleKitEnv(cwd, loaded, activeEnv, async () => {
    const proc = Bun.spawn(["bunx", "drizzle-kit", "studio", "--config", configPath], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: process.env,
    });
    const code = await proc.exited;
    return code === 0 ? EXIT_OK : EXIT_RUNTIME;
  });
}

/**
 * CLI entry: parse `oke db <push|generate|migrate|seed|studio> […]`.
 *
 * @param args - Args after `db`
 */
export async function dbCli(args: readonly string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`oke db push|generate|migrate|seed|studio [--config|-c] [--env name] [--force]

Domain schema sync via drizzle-kit, plus explicit seed.
When src/db/schema.decl.ts and/or a plugged app entry exists, emits
schema.drizzle.ts from store.schema.table + live plugin .table()
contributions — then runs drizzle-kit.
Hand-written src/schema.ts remains supported (emit skipped if nothing to emit).
Not the same as \`oke schema generate\` (core/plugin stub tables).

  push       Apply schema to the live local DB (dev; no migration files)
  generate   Write versioned SQL under drizzle/ for review
  migrate    Apply generated migrations (explicit; never automatic in prod)
  seed       Run defineSeed (essential + env category) — standard CLI path
  studio     Open drizzle-kit Studio (long-running)

  --env      Override config env (dev|test|prod)
  --force    Skip docker/prod confirmation prompt (CI)
  --entry    App entry for seed boot / plugin table discovery
`);
    return sub ? EXIT_OK : EXIT_USAGE;
  }
  if (
    sub !== "push" &&
    sub !== "generate" &&
    sub !== "migrate" &&
    sub !== "seed" &&
    sub !== "studio"
  ) {
    console.error(`oke db: unknown subcommand "${sub}"`);
    return EXIT_USAGE;
  }

  let config: string | undefined;
  let env: ConfigEnv | undefined;
  let force = false;
  let entry: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--config" || a === "-c") config = args[++i];
    else if (a === "--env") {
      const value = args[++i];
      const parsed = parseConfigEnv(value);
      if (!parsed) {
        console.error(`oke db: invalid --env ${JSON.stringify(value)} (dev|test|prod)`);
        return EXIT_USAGE;
      }
      env = parsed;
    } else if (a === "--force") force = true;
    else if (a === "--entry" || a === "-e") entry = args[++i];
    else if (a === "--help" || a === "-h") {
      return dbCli(["--help"]);
    } else if (a.startsWith("-")) {
      console.error(`oke db ${sub}: unknown flag ${a}`);
      return EXIT_USAGE;
    }
  }

  return runDb(sub, { config, env, force, entry });
}

/**
 * Install `oke.gate()` / `oke.user()` / `oke.has_scope()` before drizzle-kit
 * so `CREATE POLICY … oke.gate()` succeeds.
 *
 * @param write - Output
 */
async function installOkeRlsHelpers(write: (text: string) => void): Promise<void> {
  const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL;
  const pgliteUrl = process.env.OKE_PGLITE_URL;
  try {
    if (pgliteUrl && !url) {
      const { connectPglite } = await import("../drivers/pglite.ts");
      const conn = await connectPglite({ url: pgliteUrl });
      try {
        await runOkeRlsHelperStatements((sql) => conn.exec(sql));
      } finally {
        await conn.close();
      }
      return;
    }
    if (!url) return;
    const { connectPostgres } = await import("../drivers/postgres.ts");
    const conn = await connectPostgres({ url });
    try {
      await runOkeRlsHelperStatements((sql) => conn.exec(sql));
    } finally {
      await conn.close();
    }
  } catch (err) {
    write(`oke db: oke.* helpers skipped — ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function parseConfigEnv(value: string | undefined): ConfigEnv | undefined {
  if (value === "dev" || value === "test" || value === "prod") return value;
  // Soft-compat for older CLI flags / docs.
  if (value === "local") return "test";
  if (value === "docker") return "dev";
  return undefined;
}

/**
 * Print drizzle-kit `unresolved` statements so `missing_hints` is actionable.
 *
 * @param unresolved - Kit payload (strings or `{ sql | statement | message }`)
 */
function formatUnresolvedHints(unresolved: readonly unknown[] | undefined): string {
  if (!unresolved || unresolved.length === 0) return "";
  const lines: string[] = [];
  for (const item of unresolved) {
    if (typeof item === "string") {
      lines.push(`  ${item}`);
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const text = rec.sql ?? rec.statement ?? rec.message;
      lines.push(`  ${typeof text === "string" ? text : JSON.stringify(item)}`);
      continue;
    }
    lines.push(`  ${String(item)}`);
  }
  return `${lines.join("\n")}\n`;
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
    const detail = formatUnresolvedHints(result.unresolved);
    if (detail) write(detail);
    return EXIT_RUNTIME;
  }
  write(
    `oke db ${verb}: ${result.status}${result.error?.message ? ` — ${result.error.message}` : ""}\n`,
  );
  return EXIT_RUNTIME;
}
