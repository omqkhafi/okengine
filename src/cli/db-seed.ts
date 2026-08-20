/**
 * `oke db seed` — load `defineSeed`, boot the app store, run essential +
 * env-selected category (`dev` | `prod`).
 */

import { resolve } from "node:path";
import { intro, isCancel, outro, text } from "@clack/prompts";
import type { ConfigEnv, OkeConfig } from "../config/index.ts";
import {
  normalizeSeedFns,
  resolveSeedCategory,
  resolveSeedIdentity,
  type SeedDef,
  type SeedFn,
  type UpsertStatus,
} from "../elements/store.ts";
import {
  findAppWithPlugins,
  resolveAppEntryForPluginTables,
} from "../elements/store/load-plugin-tables.ts";
import { createFx, type Fx } from "../kernel/fx.ts";
import type { OkeApp } from "../kernel/app.ts";
import { applyComposeEnvToProcess, resolveDrizzleKitEnv } from "./drizzle-env.ts";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit.ts";
import { loadOkeConfig } from "./load-config.ts";
import { resolveDevSqlEnv } from "./resolve-dev-sql-env.ts";

/** Per-function upsert outcome counts. */
export interface SeedTally {
  upserted: number;
  changed: number;
  alreadyExisted: number;
}

/** Options for {@link runSeed}. */
export interface SeedOptions {
  readonly cwd?: string;
  readonly write?: (text: string) => void;
  readonly env?: ConfigEnv;
  /** Skip interactive confirm (`--force`). */
  readonly force?: boolean;
  /** Override seed module path (default `src/db/seed/index.ts`). */
  readonly seedPath?: string;
  /** Override app entry for boot. */
  readonly entry?: string;
  /** Injectable seed def (tests) — skips loading `seedPath`. */
  readonly seedDef?: SeedDef;
  /** Injectable fx factory (tests) — skips app boot. */
  readonly createFx?: () => Promise<{
    readonly fx: Fx;
    readonly stop: () => Promise<void>;
  }>;
  /**
   * Confirm seeding a docker/prod target. Tests inject this.
   * Default: prompt operator to type the literal env name.
   */
  readonly confirmEnv?: (env: ConfigEnv, target: string) => Promise<boolean>;
  readonly stdinIsTTY?: boolean;
  /**
   * Clack `intro` / `outro` for the standalone `oke db seed` path.
   * Default: on when stdin is a TTY.
   */
  readonly intro?: boolean;
}

/**
 * Whether `value` looks like a {@link SeedDef}.
 *
 * @param value - Candidate export
 */
export function isSeedDef(value: unknown): value is SeedDef {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  for (const key of ["essential", "dev", "prod"] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] === "function") continue;
    if (Array.isArray(o[key]) && o[key].every((f) => typeof f === "function")) continue;
    return false;
  }
  return "essential" in o || "dev" in o || "prod" in o;
}

/**
 * Redact password from a connection URL for display.
 *
 * Builds the string by hand — assigning unicode bullets to `URL.password`
 * then calling `toString()` percent-encodes them (`%E2%80%A2`).
 *
 * @param raw - Connection URL or file path
 */
export function redactConnectionTarget(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.password) return u.toString();
    const auth = u.username ? `${u.username}:••••@` : "••••@";
    return `${u.protocol}//${auth}${u.host}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return raw;
  }
}

/**
 * Human-readable DB target from drizzle overlay.
 *
 * @param overlay - Resolved drizzle-kit env overlay
 * @param dialect - postgresql (only supported kit dialect)
 */
export function formatSeedTarget(
  overlay: Readonly<Record<string, string>>,
  dialect: string,
): string {
  if (overlay.OKE_PGLITE_URL && !overlay.DATABASE_URL) {
    return `pglite ${redactConnectionTarget(overlay.OKE_PGLITE_URL)}`;
  }
  const url = overlay.DATABASE_URL ?? "(DATABASE_URL unset)";
  return `${dialect === "postgresql" ? "postgresql" : dialect} ${redactConnectionTarget(url)}`;
}

/**
 * Run one seed category's functions in order, reporting tallies.
 *
 * @param category - Label (`essential` / `dev` / `prod`)
 * @param fns - Ordered functions
 * @param fx - Privileged fx
 * @param write - Output
 */
export async function runSeedFns(
  category: string,
  fns: readonly SeedFn[],
  fx: Fx,
  write: (text: string) => void,
): Promise<void> {
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    const tally: SeedTally = { upserted: 0, changed: 0, alreadyExisted: 0 };
    const instrumented = instrumentFxUpserts(fx, tally);
    await fn(instrumented);
    const label = fn.name.length > 0 ? fn.name : String(i);
    write(
      `oke db seed: ${category} ${label} — upserted ${tally.upserted} · changed ${tally.changed} · already-existed ${tally.alreadyExisted}\n`,
    );
  }
}

/**
 * Execute a seed def for `env` — essential always, then category block.
 *
 * @param def - Seed declaration
 * @param env - Resolved env
 * @param fx - Privileged fx
 * @param write - Output
 */
export async function executeSeedDef(
  def: SeedDef,
  env: ConfigEnv,
  fx: Fx,
  write: (text: string) => void,
): Promise<void> {
  await runSeedFns("essential", normalizeSeedFns(def.essential), fx, write);
  const category = resolveSeedCategory(env);
  if (category === "dev") {
    await runSeedFns("dev", normalizeSeedFns(def.dev), fx, write);
  } else if (category === "prod") {
    await runSeedFns("prod", normalizeSeedFns(def.prod), fx, write);
  } else {
    write(`oke db seed: skip category (env ${env} runs essential only)\n`);
  }
}

/** Default seed module (create-oke `src/db` layout). */
export const DEFAULT_SEED_REL = "src/db/seed/index.ts";

/** Legacy seed module path. */
export const LEGACY_SEED_REL = "src/seed/index.ts";

/**
 * Resolve the seed module path (explicit → new default → legacy).
 *
 * @param cwd - Project root
 * @param seedPath - Optional override
 */
export async function resolveSeedModulePath(cwd: string, seedPath?: string): Promise<string> {
  if (seedPath) return resolve(cwd, seedPath);
  for (const rel of [DEFAULT_SEED_REL, LEGACY_SEED_REL]) {
    const abs = resolve(cwd, rel);
    if (await Bun.file(abs).exists()) return abs;
  }
  return resolve(cwd, DEFAULT_SEED_REL);
}

/**
 * Load `src/db/seed/index.ts` (or legacy / override) and return its SeedDef.
 *
 * @param cwd - Project root
 * @param seedPath - Relative or absolute path
 */
export async function loadSeedDef(cwd: string, seedPath?: string): Promise<SeedDef> {
  const abs = await resolveSeedModulePath(cwd, seedPath);
  if (!(await Bun.file(abs).exists())) {
    throw new Error(`oke db seed: no seed module at ${abs}`);
  }
  const mod = (await import(abs)) as Record<string, unknown>;
  const candidate = mod.default ?? mod.seed;
  if (!isSeedDef(candidate)) {
    throw new Error(
      `oke db seed: ${abs} must default-export defineSeed({ essential, dev?, prod? })`,
    );
  }
  return candidate;
}

/**
 * Boot the app entry and return an open-capability fx over its store.
 *
 * @param cwd - Project root
 * @param env - Active env
 * @param entry - Optional entry override
 * @param config - Loaded config
 */
export async function bootSeedFx(
  cwd: string,
  env: ConfigEnv,
  entry?: string,
  config?: OkeConfig | null,
): Promise<{ readonly fx: Fx; readonly stop: () => Promise<void> }> {
  if (env === "dev") {
    await applyComposeEnvToProcess(cwd);
    if (process.env.OKE_DOCKER === undefined) process.env.OKE_DOCKER = "1";
  }
  const entryAbs = await resolveAppEntryForPluginTables(cwd, entry ?? config?.db?.entry);
  if (!entryAbs) {
    throw new Error(
      "oke db seed: no app entry found — pass --entry or set package.json okengine.entry",
    );
  }
  const mod = (await import(entryAbs)) as Record<string, unknown>;
  const app = findBootableApp(mod);
  if (!app) {
    throw new Error(`oke db seed: no oke() app export in ${entryAbs}`);
  }
  await app.boot({
    env,
    startScheduler: false,
    config: config ?? undefined,
    rootDir: cwd,
    docker: process.env.OKE_DOCKER === "1",
  });
  const storeRuntime = app.elements?.store ?? app.bootResult?.store;
  if (!storeRuntime) {
    throw new Error(
      "oke db seed: app booted without a store runtime — ensure stores are registered on the app (e.g. oke({ name, stores: [db] }))",
    );
  }
  const fx = createFx({
    flow: "oke.db.seed",
    storeRuntime,
    rlsBypass: true,
  });
  return {
    fx,
    stop: async () => {
      await app.stop();
    },
  };
}

/**
 * Run `oke db seed`.
 *
 * @param options - Paths / injectables
 */
export async function runSeed(options: SeedOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const env = options.env ?? (await resolveDevSqlEnv(cwd));
  const tty = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const useIntro = options.intro !== false && tty;
  if (useIntro) intro("oke db seed");

  const finish = (code: number, message: string): number => {
    if (useIntro) outro(message);
    return code;
  };

  let targetLabel = String(env);
  try {
    const { dialect, overlay } = await resolveDrizzleKitEnv(cwd, loaded?.config, env);
    targetLabel = formatSeedTarget(overlay, dialect);
  } catch {
    /* target display is best-effort */
  }
  write(`oke db seed: env ${env} → ${targetLabel}\n`);

  if (env === "dev" || env === "prod") {
    if (options.force !== true) {
      const confirm =
        options.confirmEnv ??
        (tty
          ? (e: ConfigEnv, t: string) => promptSeedConfirm(e, t, write)
          : async () => {
              write(
                `oke db seed: non-interactive ${env} requires --force (target ${targetLabel})\n`,
              );
              return false;
            });
      const ok = await confirm(env, targetLabel);
      if (!ok) {
        write("oke db seed: cancelled\n");
        return finish(EXIT_USAGE, "Cancelled.");
      }
    }
  }

  let stop: (() => Promise<void>) | undefined;
  try {
    const def = options.seedDef ?? (await loadSeedDef(cwd, options.seedPath));
    const identity = resolveSeedIdentity(def, cwd);
    write(
      identity.description
        ? `oke db seed: ${identity.name} — ${identity.description}\n`
        : `oke db seed: ${identity.name}\n`,
    );
    const session = options.createFx
      ? await options.createFx()
      : await bootSeedFx(cwd, env, options.entry, loaded?.config);
    stop = session.stop;
    await executeSeedDef(def, env, session.fx, write);
    write("oke db seed: ok\n");
    return finish(EXIT_OK, "oke db seed: ok");
  } catch (err) {
    write(`oke db seed: ${err instanceof Error ? err.message : String(err)}\n`);
    return finish(EXIT_RUNTIME, "oke db seed: failed");
  } finally {
    if (stop) await stop().catch(() => {});
  }
}

/**
 * Interactive confirm — operator must type the literal env name.
 *
 * @param env - Env name to type
 * @param target - Displayed connection target
 * @param write - Output
 */
async function promptSeedConfirm(
  env: ConfigEnv,
  target: string,
  write: (text: string) => void,
): Promise<boolean> {
  write(`oke db seed: confirm target ${target}\n`);
  const answer = await text({
    message: `Type "${env}" to seed this database`,
    validate(value) {
      if (value === env) return undefined;
      return `Type ${JSON.stringify(env)} exactly to confirm`;
    },
  });
  if (isCancel(answer)) return false;
  return answer === env;
}

function findBootableApp(mod: Record<string, unknown>): OkeApp | undefined {
  const plugged = findAppWithPlugins(mod);
  if (plugged && isBootableApp(plugged)) return plugged as OkeApp;
  for (const key of ["app", "default", ...Object.keys(mod)]) {
    const value = mod[key];
    if (isBootableApp(value)) return value as OkeApp;
  }
  return undefined;
}

function isBootableApp(value: unknown): value is OkeApp {
  if (!value || typeof value !== "object") return false;
  const o = value as { boot?: unknown; stop?: unknown };
  return typeof o.boot === "function" && typeof o.stop === "function";
}

function instrumentFxUpserts(fx: Fx, tally: SeedTally): Fx {
  const originalStore = fx.store.bind(fx);
  return new Proxy(fx, {
    get(target, prop, receiver) {
      if (prop === "store") {
        return (ref: Parameters<Fx["store"]>[0]) => {
          const handle = originalStore(ref);
          return instrumentUpsertHandle(handle, tally);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function instrumentUpsertHandle<T>(handle: T, tally: SeedTally): T {
  if (!handle || typeof handle !== "object") return handle;
  const h = handle as { upsert?: (...args: unknown[]) => Promise<{ status: UpsertStatus }> };
  if (typeof h.upsert !== "function") return handle;
  const orig = h.upsert.bind(h);
  return new Proxy(handle as object, {
    get(target, prop, receiver) {
      if (prop === "upsert") {
        return async (...args: unknown[]) => {
          const result = await orig(...args);
          const status =
            result && typeof result === "object" && "status" in result
              ? (result as { status: UpsertStatus }).status
              : undefined;
          if (status === "upserted") tally.upserted += 1;
          else if (status === "changed") tally.changed += 1;
          else if (status === "already-existed") tally.alreadyExisted += 1;
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}
