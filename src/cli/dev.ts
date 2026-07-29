/**
 * `oke dev` — watch · hot reload · Console :6533 · MCP :6535 · client types on save.
 * Mode: `local` (in-memory) or `docker` (compose infra + host Bun).
 */

import { watch } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionStore } from "../auth/sessions.ts";
import type { ConsoleAppHandle } from "../console/server/app.ts";
import type { ConsoleState } from "../console/server/state.ts";
import {
  DEFAULT_DOCKER_DIR,
  deriveInfrastructure,
  loadExistingStackControls,
  loadExistingStackCredentials,
  resolveExtraPorts,
  stackAppSlug,
  stackInstanceId,
  writeDerivedFiles,
  type DeriveOptions,
} from "../docker/index.ts";
import type { Manifest } from "../manifest/types.ts";
import type { McpContext } from "../mcp/tools.ts";
import { APP_PORT, CONSOLE_PORT, MCP_PORT } from "../runtime/types.ts";
import {
  formatDevBanner,
  formatDevLogSeparator,
  formatServiceLine,
  formatStackSummary,
  formatStatusLine,
} from "../term.ts";
import { clientAdd } from "./client-add.ts";
import { resolveDriverId } from "../config/index.ts";
import { askDevMode, type AskDevModeFn } from "./ask-dev-mode.ts";
import {
  createDebouncedRunner,
  isDomainSchemaWatchPath,
  resolveDevAutoPush,
} from "./db-auto-push.ts";
import { resolveDrizzleConfigPath, runPush } from "./db.ts";
import { readDevMode, shouldAskDevMode, writeDevMode, type DevMode } from "./dev-mode.ts";
import { buildDevHeroSnapshot, encodeHeroSnapshot } from "./hero-meta.ts";
import { loadManifest, loadOkeConfig, resolveImages } from "./load-config.ts";
import { mcpContextFromConsole } from "./mcp-from-console.ts";
import { resolveDevPorts } from "./ports.ts";

/** Max wait for the `bun --hot` app child to bind a port. */
const APP_READY_TIMEOUT_MS = 30_000;

/** Stoppable surface handle. */
export interface DevSurfaceHandle {
  readonly stop: () => void;
}

/** App surface returned by {@link DevOptions.startApp}. */
export interface DevAppHandle {
  readonly stop: () => void;
  /** Bound listen port (set when serve chooses an ephemeral port). */
  readonly port?: number;
  /** Base URL of the app server. */
  readonly url?: URL;
}

/** Console surface returned by {@link DevOptions.serveConsole}. */
export interface DevConsoleHandle extends DevSurfaceHandle {
  /**
   * Live Console kernel — when present, MCP binds to this state
   * (same Manifest / sessions / runs).
   */
  readonly console?: ConsoleAppHandle;
  /** Bound listen port (may differ from the requested port when `0`). */
  readonly port?: number;
}

/** MCP surface returned by {@link DevOptions.serveMcp}. */
export interface DevMcpHandle extends DevSurfaceHandle {
  /** Bound listen port. */
  readonly port?: number;
  /** Base URL of the MCP server. */
  readonly url?: URL;
}

/** Options for {@link DevOptions.serveMcp}. */
export interface DevServeMcpOptions {
  readonly port: number;
  readonly sessions: SessionStore;
  readonly secret: string;
  readonly context: McpContext;
  readonly now?: () => number;
  readonly hostname?: string;
}

/** Live `oke dev` session — returned when {@link DevOptions.keepAlive} is false. */
export interface DevSession {
  readonly plan: DevPlan;
  /** Stop app · Console · MCP · watcher. */
  readonly stop: () => void;
  readonly appPort: number;
  readonly consolePort: number;
  readonly mcpPort: number;
  readonly mcpUrl: URL | null;
  /** Shared with Console — mint `oke-mcp` tokens against this store/secret. */
  readonly secret: string | null;
  readonly sessions: SessionStore | null;
  /** Same Console state MCP reads through (tests seed Manifest / runs here). */
  readonly consoleState: ConsoleState | null;
}

/** Minimal filesystem watcher contract, injectable for deterministic tests. */
export type DevWatchFn = (
  path: string,
  options: { readonly recursive: true },
  listener: (event: "rename" | "change", filename: string | null) => void,
) => { close(): void };

/** Options for {@link runDev}. */
export interface DevOptions {
  readonly cwd?: string;
  readonly entry?: string;
  /**
   * Session-only mode override. `true` / role list → docker; `false` → local.
   * When unset, resolve from `.oke/mode` / TTY ask / non-TTY default `local`.
   */
  readonly docker?: boolean | readonly string[];
  /** Force local for this session only (never writes `.oke/mode`). */
  readonly local?: boolean;
  /**
   * Opt out of auto `oke db push` on schema change for this session.
   * Also set via `--no-db-push`.
   */
  readonly noDbPush?: boolean;
  /**
   * Injectable domain-schema push (tests). Default: {@link runPush}.
   *
   * @param cwd - Project root
   */
  readonly dbPush?: (cwd: string) => Promise<number>;
  /**
   * Called when a schema watch path triggers auto-push (tests).
   *
   * @param filename - Relative path from the watcher
   */
  readonly onDbAutoPush?: (filename: string) => void;
  /** Watch project source changes (injectable for tests). */
  readonly watchFs?: DevWatchFn;
  readonly images?: Readonly<Record<string, string>>;
  readonly credentials?: DeriveOptions["credentials"];
  readonly write?: (text: string) => void;
  /** Skip spawning the watcher / servers (unit tests). */
  readonly dryRun?: boolean;
  /**
   * When false, return a {@link DevSession} after boot instead of hanging
   * (integration tests). Default true for the CLI.
   */
  readonly keepAlive?: boolean;
  /** Called once all surfaces are listening (before keep-alive). */
  readonly onReady?: (session: DevSession) => void | Promise<void>;
  /** Operator auth secret (shared by Console + MCP). */
  readonly secret?: string;
  /** Seed Manifest into Console (and therefore MCP). */
  readonly manifest?: Manifest | null;
  /** Suppress claim-code print (tests). */
  readonly silentClaim?: boolean;
  /** Port overrides (use `0` for ephemeral in tests). */
  readonly appPort?: number;
  readonly consolePort?: number;
  readonly mcpPort?: number;
  /**
   * Boot compose (injectable).
   *
   * @param composeFiles - `-f` list excluding override if missing
   * @param cwd - Compose directory (`docker/`)
   */
  readonly composeUp?: (composeFiles: readonly string[], cwd: string) => Promise<void>;
  /**
   * Regenerate client types (injectable).
   *
   * @param appUrl - App base URL
   */
  readonly regenClient?: (appUrl: string) => Promise<void>;
  /** Serve Console (injectable). */
  readonly serveConsole?: (port: number) => Promise<DevConsoleHandle>;
  /**
   * Serve MCP against the live Console context (injectable).
   * Default: {@link serveMcp} on :6535.
   */
  readonly serveMcp?: (options: DevServeMcpOptions) => Promise<DevMcpHandle>;
  /**
   * Boot + serve the app entry (injectable).
   * Default: spawn `bun --hot` on the shipped {@link ./dev-app-runner.ts}
   * (import → `app.boot()` → `createBunRuntime().serve`) so Bun soft-reloads
   * app code while preserving the listen socket.
   */
  readonly startApp?: (entry: string, env: Record<string, string>) => Promise<DevAppHandle>;
  /**
   * Injectable mode prompt (tests). Default: {@link askDevMode}.
   */
  readonly ask?: AskDevModeFn;
  /**
   * Override stdin TTY detection (tests). Default: `process.stdin.isTTY`.
   */
  readonly stdinIsTTY?: boolean;
}

/** Result of a dry-run / prepared / live-but-detached dev session. */
export interface DevPlan {
  readonly entry: string;
  readonly appPort: number;
  readonly consolePort: number;
  readonly mcpPort: number;
  readonly stackRoles: readonly string[] | null;
  readonly composeFiles: readonly string[] | null;
  readonly stackEnv: Readonly<Record<string, string>> | null;
}

/** Result of {@link runDev}. */
export interface DevResult {
  readonly code: number;
  readonly plan?: DevPlan;
  /** Present when {@link DevOptions.keepAlive} is false. */
  readonly session?: DevSession;
}

/**
 * Prepare (and optionally run) a dev session.
 *
 * @param options - Flags
 */
export async function runDev(options: DevOptions = {}): Promise<DevResult> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const preferredApp = options.appPort ?? Number(Bun.env.PORT ?? APP_PORT);
  const preferredConsole = options.consolePort ?? CONSOLE_PORT;
  const preferredMcp = options.mcpPort ?? MCP_PORT;
  // Explicit overrides (incl. `0` ephemeral) skip probing; otherwise +1 until free.
  const ports =
    options.appPort !== undefined ||
    options.consolePort !== undefined ||
    options.mcpPort !== undefined
      ? {
          app: preferredApp,
          console: preferredConsole,
          mcp: preferredMcp,
        }
      : await resolveDevPorts({
          app: preferredApp,
          console: preferredConsole,
          mcp: preferredMcp,
        });
  const appPort = ports.app;
  const consolePort = ports.console;
  const mcpPort = ports.mcp;
  const keepAlive = options.keepAlive ?? true;

  let entry = options.entry;
  if (!entry) {
    for (const c of ["src/app.ts", "src/index.ts", "index.ts", "app.ts"]) {
      if (await Bun.file(resolve(cwd, c)).exists()) {
        entry = c;
        break;
      }
    }
  }
  if (!entry) {
    console.error("oke dev: no entry found (src/app.ts)");
    return { code: 1 };
  }

  const explicitLocal = options.local === true;
  const explicitDocker = options.docker === true || Array.isArray(options.docker);
  if (explicitLocal && explicitDocker) {
    console.error("oke dev: use either --local or --docker, not both");
    return { code: 1 };
  }

  const savedMode = await readDevMode(cwd);
  const explicit = explicitLocal || explicitDocker;
  let mode: DevMode;
  if (explicitLocal) {
    mode = "local";
  } else if (explicitDocker) {
    mode = "docker";
  } else if (savedMode !== null) {
    mode = savedMode;
  } else if (
    shouldAskDevMode({
      saved: savedMode,
      explicit,
      stdinIsTTY: options.stdinIsTTY ?? process.stdin.isTTY,
    })
  ) {
    const ask = options.ask ?? askDevMode;
    const chosen = await ask();
    if (chosen === null) {
      console.error("oke dev: cancelled");
      return { code: 1 };
    }
    mode = chosen;
    await writeDevMode(cwd, mode);
  } else {
    // Non-TTY + unset: deterministic local — zero ask, zero docker, no save.
    mode = "local";
  }

  let stackRoles: string[] | null = null;
  let composeFiles: string[] | null = null;
  let stackEnv: Record<string, string> | null = null;
  let stackSqlDriver = "postgres";
  let stackKvDriver = "redis";
  let loadedConfig: Awaited<ReturnType<typeof loadOkeConfig>>["config"] | null = null;
  try {
    loadedConfig = (await loadOkeConfig(cwd)).config;
  } catch {
    loadedConfig = null;
  }

  if (mode === "docker") {
    let images = options.images;
    if (!images) {
      if (!loadedConfig) {
        try {
          const loaded = await loadOkeConfig(cwd);
          loadedConfig = loaded.config;
          images = resolveImages(loaded.config);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          return { code: 1 };
        }
      } else {
        images = resolveImages(loadedConfig);
      }
    } else if (!loadedConfig) {
      try {
        loadedConfig = (await loadOkeConfig(cwd)).config;
      } catch {
        loadedConfig = null;
      }
    }
    if (Array.isArray(options.docker)) {
      const allow = new Set(options.docker);
      images = Object.fromEntries(Object.entries(images).filter(([role]) => allow.has(role)));
      stackRoles = [...allow];
    } else {
      stackRoles = Object.keys(images);
    }

    stackSqlDriver = resolveDriverId(loadedConfig?.drivers?.store?.sql, "prod") ?? "postgres";
    stackKvDriver = resolveDriverId(loadedConfig?.drivers?.store?.kv, "prod") ?? "redis";

    const composeDir = DEFAULT_DOCKER_DIR;
    const dockerOut = resolve(cwd, composeDir);
    const instanceId = stackInstanceId(cwd);
    const appSlug = stackAppSlug(cwd);
    const reusedCreds =
      options.credentials ?? (await loadExistingStackCredentials(cwd, stackRoles));
    const controls = await loadExistingStackControls(cwd);
    const derived = deriveInfrastructure({
      images,
      app: appSlug,
      prod: false,
      includeApp: false,
      composeDir,
      instanceId,
      ...(reusedCreds ? { credentials: reusedCreds } : {}),
      ...(controls ? { controls } : {}),
      host: "127.0.0.1",
    });
    // Layer 4 is user-owned — include only if the file already exists.
    const existingOverride = await Bun.file(resolve(dockerOut, "compose.override.yml")).exists();
    composeFiles = derived.composeFiles.filter(
      (f) => f !== "compose.override.yml" || existingOverride,
    );
    stackEnv = { ...derived.stackEnv };

    if (!options.dryRun) {
      try {
        await writeDerivedFiles(derived, dockerOut, {
          writeStackEnv: true,
        });
        const up =
          options.composeUp ??
          (async (files, dir) => {
            const args = ["compose", ...files.flatMap((f) => ["-f", f]), "up", "-d"];
            const proc = Bun.spawn(["docker", ...args], {
              cwd: dir,
              stdout: "inherit",
              stderr: "inherit",
              env: { ...process.env, ...stackEnv! },
            });
            const code = await proc.exited;
            if (code !== 0) {
              throw new Error(`oke dev --docker: docker compose exited ${code}`);
            }
          });
        // Compose files live under docker/; cwd for compose is that directory.
        await up(composeFiles, dockerOut);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        console.error("oke dev: docker mode failed — fix compose, or run `oke mode local`");
        return { code: 1 };
      }
      const roleLabel = (role: string): string => {
        if (role === "store.sql") return "postgres";
        if (role === "store.kv") return "redis";
        if (role === "store.files") return "files";
        if (role === "channel.email") return "mail";
        return role;
      };
      const extraLabel = (role: string, containerPort: number): string => {
        if (role === "channel.email" && containerPort === 8025) return "mail-ui";
        if (role === "store.files" && containerPort === 9001) return "files-ui";
        return `${roleLabel(role)}+${containerPort}`;
      };
      const appDrivers = [
        ...(stackRoles.includes("store.sql") ? [stackSqlDriver] : []),
        ...(stackRoles.includes("store.kv") ? [stackKvDriver] : []),
      ];
      write(
        formatStackSummary({
          project: `oke-${appSlug}`,
          services: derived.specs.flatMap((spec) => [
            { label: roleLabel(spec.role), hostPort: spec.hostPort },
            ...resolveExtraPorts(spec, { images, instanceId }).map((p) => ({
              label: extraLabel(spec.role, p.containerPort),
              hostPort: p.hostPort,
            })),
          ]),
          appDrivers,
        }),
      );
    }
  }

  const plan: DevPlan = {
    entry: resolve(cwd, entry),
    appPort,
    consolePort,
    mcpPort,
    stackRoles,
    composeFiles,
    stackEnv,
  };

  let okeVersion = "0.0.0";
  try {
    const pkg = (await Bun.file(resolve(import.meta.dir, "../../package.json")).json()) as {
      version?: string;
    };
    if (typeof pkg.version === "string") okeVersion = pkg.version;
  } catch {
    // shipped binary may not sit next to package.json
  }

  const heroSnapshot = buildDevHeroSnapshot({
    config: loadedConfig,
    docker: mode === "docker",
    sqlDriver: mode === "docker" ? stackSqlDriver : undefined,
    kvDriver: mode === "docker" ? stackKvDriver : undefined,
    version: okeVersion,
    nodeEnv: "development",
  });

  write(
    formatDevBanner({
      profile: heroSnapshot.profile,
      runtimeEnv: heroSnapshot.runtimeEnv,
      system: heroSnapshot.system,
      elements: heroSnapshot.elements,
      version: okeVersion,
    }),
  );

  if (options.dryRun) return { code: 0, plan };

  // One-shot schema sync for the session profile (both local and docker):
  // emits schema.generated.ts for the active dialect, then pushes via
  // drizzle-kit. Data planes stay isolated — session flags never rewrite
  // `.oke/mode`. Watch auto-push below remains local-only.
  if (!options.noDbPush) {
    const { syncDevSchema } = await import("./dev-schema-sync.ts");
    try {
      const result = await syncDevSchema(cwd, mode, { write });
      write(
        formatStatusLine(
          `oke db push (${mode} · ${result.dialect}) ${result.code === 0 ? "ok" : "failed"}`,
        ),
      );
    } catch (err) {
      write(
        formatStatusLine(
          `oke db push (${mode}) skipped — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  const autoPushEnabled = resolveDevAutoPush({
    noDbPush: options.noDbPush,
    docker: Boolean(stackEnv),
    configAutoPush: loadedConfig?.db?.autoPush,
  });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: "development",
    PORT: String(appPort),
    OKE_DEV_REQUEST_LOG: "1",
    /** Soft-reload hero reprint (Console / MCP URLs + element snapshot). */
    OKE_DEV_HERO_CONSOLE: `http://127.0.0.1:${consolePort}`,
    OKE_DEV_HERO_MCP: `http://127.0.0.1:${mcpPort}`,
    OKE_DEV_HERO_META: encodeHeroSnapshot(heroSnapshot),
    // Propagate opt-out so the app disables ensureFromMeta when auto-push owns DDL.
    ...(autoPushEnabled ? { OKE_DB_AUTO_PUSH: "1" } : { OKE_DB_AUTO_PUSH: "0" }),
    ...(stackEnv ?? {}),
    ...(stackEnv
      ? {
          OKE_DOCKER: "1",
          OKE_SQL_DRIVER: stackSqlDriver,
          OKE_KV_DRIVER: stackKvDriver,
        }
      : {}),
  };
  process.env.OKE_DEV_REQUEST_LOG = "1";

  const startApp = options.startApp ?? ((entryPath, appEnv) => startAppHot(cwd, entryPath, appEnv));

  const seedManifest =
    options.manifest !== undefined ? options.manifest : await tryLoadProjectManifest(cwd);

  async function refreshManifestInto(state: ConsoleState | null): Promise<void> {
    if (!state) return;
    try {
      const { extractManifest } = await import("../compiler/extract.ts");
      const { feedManifest } = await import("../console/server/live.ts");
      const next = await extractManifest({ rootDir: cwd });
      feedManifest(state, next);
    } catch {
      // Source may be mid-edit — keep the last good Manifest.
    }
  }

  const serveConsole =
    options.serveConsole ??
    (async (port) => {
      const { serveConsole: serveConsoleKernel } = await import("../console/server/serve.ts");
      const server = await serveConsoleKernel({
        port,
        hostname: "127.0.0.1",
        cwd,
        env: "dev",
        silentClaim: options.silentClaim ?? false,
        ...(options.secret !== undefined ? { secret: options.secret } : {}),
        ...(seedManifest !== undefined && seedManifest !== null ? { manifest: seedManifest } : {}),
      });
      write(formatServiceLine("Console", `http://127.0.0.1:${server.port}`));
      return {
        console: server.console,
        port: server.port,
        stop() {
          server.stop(true);
        },
      };
    });

  const serveMcpSurface =
    options.serveMcp ??
    (async (mcpOptions) => {
      const { serveMcp } = await import("../mcp/server.ts");
      const server = await serveMcp({
        port: mcpOptions.port,
        hostname: mcpOptions.hostname ?? "127.0.0.1",
        sessions: mcpOptions.sessions,
        secret: mcpOptions.secret,
        context: mcpOptions.context,
        now: mcpOptions.now,
      });
      write(formatServiceLine("MCP", `http://127.0.0.1:${server.port}`));
      return {
        port: server.port,
        url: server.url,
        stop() {
          server.stop(true);
        },
      };
    });

  const regen =
    options.regenClient ??
    (async (appUrl) => {
      try {
        await clientAdd({
          url: appUrl,
          out: resolve(cwd, "oke-client.d.ts"),
        });
        write(formatStatusLine("regenerated oke-client.d.ts"));
      } catch {
        // App may not be ready yet — ignore until next save.
      }
    });

  const app = await startApp(plan.entry, env);
  const boundAppPort = app.port ?? appPort;
  const consoleServer = await serveConsole(consolePort);
  const boundConsolePort = consoleServer.port ?? consolePort;

  let mcpServer: DevMcpHandle | null = null;
  let consoleState: ConsoleState | null = null;
  let secret: string | null = null;
  let sessions: SessionStore | null = null;

  if (consoleServer.console) {
    const state = consoleServer.console.state;
    consoleState = state;
    secret = state.secret;
    sessions = state.sessions;
    mcpServer = await serveMcpSurface({
      port: mcpPort,
      sessions: state.sessions,
      secret: state.secret,
      context: mcpContextFromConsole(state),
      now: state.now,
      hostname: "127.0.0.1",
    });
  }

  const boundMcpPort = mcpServer?.port ?? mcpPort;
  const mcpUrl = mcpServer?.url ?? null;

  const appUrl = app.url?.origin ?? `http://127.0.0.1:${boundAppPort}`;
  await regen(appUrl);

  const dbPush =
    options.dbPush ??
    (async (projectCwd: string) => {
      const configPath = await resolveDrizzleConfigPath(projectCwd);
      return runPush(configPath, (t) => write(t), { cwd: projectCwd, env: mode });
    });

  let lastSchemaFilename = "";
  const autoPushRunner = createDebouncedRunner(async () => {
    if (!autoPushEnabled) return;
    options.onDbAutoPush?.(lastSchemaFilename);
    write(formatStatusLine("oke db push (schema change)"));
    try {
      await dbPush(cwd);
    } catch {
      // Mid-edit / kit unavailable — next save retries.
    }
  });

  // Initial sync so local DB matches schema.ts without a prior manual push.
  if (autoPushEnabled) {
    lastSchemaFilename = "src/schema.ts";
    autoPushRunner.trigger();
  }

  write(formatDevLogSeparator());

  const watchFs: DevWatchFn =
    options.watchFs ?? ((path, watchOptions, listener) => watch(path, watchOptions, listener));
  const watcher = watchFs(resolve(cwd, "src"), { recursive: true }, (_event, filename) => {
    void regen(appUrl);
    // Only live-extract when the host did not pin a Manifest (tests).
    if (options.manifest === undefined) {
      void refreshManifestInto(consoleState);
    }
    if (autoPushEnabled && isDomainSchemaWatchPath(filename?.toString())) {
      lastSchemaFilename = filename?.toString() ?? "schema.ts";
      autoPushRunner.trigger();
    }
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    autoPushRunner.cancel();
    watcher.close();
    app.stop();
    consoleServer.stop();
    mcpServer?.stop();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };

  const onSignal = () => {
    stop();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const session: DevSession = {
    plan: {
      ...plan,
      appPort: boundAppPort,
      consolePort: boundConsolePort,
      mcpPort: boundMcpPort,
    },
    stop,
    appPort: boundAppPort,
    consolePort: boundConsolePort,
    mcpPort: boundMcpPort,
    mcpUrl,
    secret,
    sessions,
    consoleState,
  };

  if (options.onReady) await options.onReady(session);

  if (!keepAlive) {
    return { code: 0, plan: session.plan, session };
  }

  // Keep the process alive.
  await new Promise(() => {});
  return { code: 0, plan: session.plan, session };
}

/**
 * True when a Manifest has no declared flows (scaffold / empty extract).
 *
 * @param manifest - Candidate
 */
function isSparseManifest(manifest: Manifest): boolean {
  const flows = manifest.flows;
  if (!flows || typeof flows !== "object") return true;
  return Object.keys(flows).length === 0;
}

/**
 * Load Manifest — prefer AoT extract from `src/` when it has flows;
 * otherwise on-disk JSON snapshots; otherwise a sparse extract.
 *
 * @param cwd - Project root
 */
async function tryLoadProjectManifest(cwd: string): Promise<Manifest | null | undefined> {
  let extracted: Manifest | undefined;
  try {
    const { extractManifest } = await import("../compiler/extract.ts");
    extracted = await extractManifest({ rootDir: cwd });
  } catch {
    // Fall through to JSON snapshots.
  }

  let fromDisk: Manifest | undefined;
  for (const name of ["oke.manifest.json", "manifest.oke.json"]) {
    const path = resolve(cwd, name);
    if (await Bun.file(path).exists()) {
      fromDisk = await loadManifest(path);
      break;
    }
  }

  if (extracted && !isSparseManifest(extracted)) return extracted;
  if (fromDisk) return fromDisk;
  return extracted;
}

/**
 * Default app boot: `bun --hot` on the shipped runner (socket-preserving).
 *
 * @param cwd - Project root
 * @param entryPath - App entry (absolute or cwd-relative)
 * @param appEnv - Env overlay (`PORT`, stack vars, …)
 */
async function startAppHot(
  cwd: string,
  entryPath: string,
  appEnv: Record<string, string>,
): Promise<DevAppHandle> {
  const absoluteEntry = resolve(cwd, entryPath);
  const runner = resolve(import.meta.dir, "dev-app-runner.ts");
  const readyPath = join(tmpdir(), `oke-dev-ready-${crypto.randomUUID()}.txt`);
  const hostname = "127.0.0.1";
  const env: Record<string, string> = {
    ...appEnv,
    OKE_ENTRY: absoluteEntry,
    OKE_HOSTNAME: hostname,
    OKE_READY_PATH: readyPath,
    OKE_DEV_REQUEST_LOG: "1",
    OKE_DEV_SURFACE: "App",
  };

  // `--no-clear-screen`: Bun must not wipe the hero; the runner clears only
  // request logs on soft reload and reprints App / Console / MCP URLs.
  const proc = Bun.spawn(["bun", "--hot", "--no-clear-screen", runner], {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      // SIGKILL so `bun --hot` cannot linger and hold the project directory
      // open (create-oke afterEach `rmSync` otherwise races the child exit).
      proc.kill("SIGKILL");
    } catch {
      // already exited
    }
    void unlink(readyPath).catch(() => {});
  };

  try {
    const boundPort = await waitForAppReady(readyPath, proc, APP_READY_TIMEOUT_MS);
    // Child prints the App ready line (again on each soft reload).
    const url = new URL(`http://${hostname}:${boundPort}/`);
    return { stop, port: boundPort, url };
  } catch (err) {
    stop();
    throw err;
  }
}

/**
 * Poll the ready file until the app child binds a port (or exits).
 *
 * @param readyPath - Path the runner writes
 * @param proc - Child process
 * @param timeoutMs - Max wait
 */
async function waitForAppReady(
  readyPath: string,
  proc: Bun.Subprocess,
  timeoutMs: number,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const exitCode = proc.exitCode;
    if (exitCode !== null) {
      throw new Error(`oke dev: app process exited before ready (code ${exitCode})`);
    }
    if (await Bun.file(readyPath).exists()) {
      const text = (await Bun.file(readyPath).text()).trim();
      const port = Number(text);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error(`oke dev: invalid ready port from app child: ${text}`);
      }
      return port;
    }
    await Bun.sleep(25);
  }
  throw new Error(`oke dev: app did not become ready within ${timeoutMs}ms`);
}

/**
 * CLI entry for `oke dev [--local|-l] [--docker|-d [roles]]`.
 *
 * @param args - Args after `dev`
 */
export async function devCli(args: readonly string[]): Promise<number> {
  let docker: boolean | string[] | undefined;
  let local = false;
  let noDbPush = false;
  let entry: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--local" || a === "-l") {
      local = true;
    } else if (a === "--docker" || a === "-d") {
      const next = args[i + 1];
      if (next && !next.startsWith("-") && /^[\w.,]+$/.test(next)) {
        docker = next
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        i++;
      } else {
        docker = true;
      }
    } else if (a === "--no-db-push") {
      noDbPush = true;
    } else if (a === "--entry" || a === "-e") entry = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke dev [--local|-l] [--docker|-d [roles]] [--no-db-push] [--entry|-e src/app.ts]

Watch · hot reload · Console :6533 · app :6530 · MCP :6535
Regenerates client types on every save.
Local mode auto-runs \`oke db push\` when schema.ts changes (opt out: --no-db-push).

Bare \`oke dev\` uses .oke/mode (one-time prompt on a TTY; non-TTY → local).
--local / --docker override for this session only (never write .oke/mode).
--docker boots infra under docker/ and runs the app on host Bun with prod
store drivers (Postgres/Redis). Partial roles: -d store.sql,store.kv.
Change the saved default with \`oke mode local|docker\`.
`);
      return 0;
    }
  }
  const { code } = await runDev({
    ...(local ? { local: true } : {}),
    ...(docker === undefined ? {} : { docker }),
    ...(noDbPush ? { noDbPush: true } : {}),
    entry,
  });
  return code;
}
