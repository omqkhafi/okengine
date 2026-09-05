/**
 * `oke dev` — watch · hot reload · Console :6533 · MCP :6535 · client types on save.
 * Always starts Docker Compose infra and runs the app on host Bun.
 */

import { watch } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionStore } from "../auth/sessions.ts";
import type { ConsoleAppHandle } from "../console/server/app.ts";
import { RUNS_INGEST_PATH } from "../console/server/runs-ingest.ts";
import type { ConsoleState } from "../console/server/state.ts";
import { RUNS_INGEST_SECRET_ENV, RUNS_INGEST_URL_ENV } from "../runs/bridge-to-console.ts";
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
import { APP_PORT, CONSOLE_PORT, DOCS_MCP_PORT, MCP_PORT } from "../runtime/types.ts";
import {
  clearTerminalScreen,
  createAnchoredBoard,
  createBootProgress,
  devStatusFromAiPhase,
  formatBootWarn,
  formatBoundSurfaces,
  formatClaimNote,
  formatCliChrome,
  formatDevBanner,
  formatDevHeroDetails,
  formatDevLogSeparator,
  formatServiceLine,
  formatStackSummary,
  formatStatusLine,
  termColorEnabled,
  type BootProgress,
  type DevStatus,
  type StackSummaryService,
} from "../term.ts";
import { clientAdd } from "./client-add.ts";
import { resolveDriverId } from "../config/index.ts";
import type { DevComposeControlAction } from "./dev-controls.ts";
import {
  createDebouncedRunner,
  isDomainSchemaWatchPath,
  resolveDevAutoPush,
} from "./db-auto-push.ts";
import { resolveDrizzleConfigPath, runPush } from "./db.ts";
import {
  buildDevHeroSnapshot,
  encodeHeroSnapshot,
  formatHeroSystemLine,
  resolveDevProfile,
  resolveDevRuntimeEnv,
} from "./hero-meta.ts";
import { loadManifest, loadOkeConfig, resolveImages } from "./load-config.ts";
import { mcpContextFromConsole } from "./mcp-from-console.ts";
import { resolveDevPorts } from "./ports.ts";
import {
  shouldAttachConsoleVite,
  startConsoleVite,
  type ConsoleViteHandle,
  type StartConsoleViteOptions,
} from "./dev-console-vite.ts";
import { clearDevSessionLock, writeDevSessionLock } from "./dev-session-lock.ts";

/** Max wait for the `bun --hot` app child to bind a port. */
const APP_READY_TIMEOUT_MS = 30_000;

/** Stoppable surface handle. */
export interface DevSurfaceHandle {
  readonly stop: () => void;
}

/** App surface returned by {@link DevOptions.startApp}. */
export interface DevAppHandle {
  readonly stop: () => void | Promise<void>;
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

/** Options for {@link DevOptions.serveDocsMcp}. */
export interface DevServeDocsMcpOptions {
  readonly port: number;
  readonly hostname?: string;
}

/** Live `oke dev` session — returned when {@link DevOptions.keepAlive} is false. */
export interface DevSession {
  readonly plan: DevPlan;
  /** Stop app · Console · MCP · watcher · docker compose (when this session started it). */
  readonly stop: () => void;
  readonly appPort: number;
  readonly consolePort: number;
  readonly mcpPort: number;
  readonly mcpUrl: URL | null;
  /** Docs MCP listen port (read-only, unauthenticated). */
  readonly docsMcpPort: number;
  /** Docs MCP base URL — null when the surface was skipped. */
  readonly docsMcpUrl: URL | null;
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
   * Optional compose role filter. `true` / unset → all roles from images;
   * a string list → only those roles.
   */
  readonly docker?: boolean | readonly string[];
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
  /**
   * Injectable `.adopt()` barrel regeneration (tests). Default: real
   * `generateAdoptBarrel` + atomic write to `<cwd>/src/flows/generated.ts`
   * (`generated.ts.tmp` → rename). Runs at session start and again on
   * `src/flows/**` changes except `generated.ts` itself. Write-if-changed
   * so the `src/` watcher + bun `--hot` do not loop.
   *
   * @param cwd - Project root
   */
  readonly syncAdoptBarrel?: (cwd: string) => Promise<readonly string[]>;
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
  /** Suppress kernel stdout claim print (default true — the live board owns it). */
  readonly silentClaim?: boolean;
  /** Port overrides (use `0` for ephemeral in tests). */
  readonly appPort?: number;
  readonly consolePort?: number;
  readonly mcpPort?: number;
  readonly docsMcpPort?: number;
  /**
   * Boot compose (injectable).
   *
   * @param composeFiles - `-f` list excluding override if missing
   * @param cwd - Compose directory (`docker/`)
   */
  readonly composeUp?: (composeFiles: readonly string[], cwd: string) => Promise<void>;
  /**
   * Stop compose containers on session exit (injectable). Keeps volumes.
   * Default: `docker compose … stop` with the same `-f` / cwd / env as up.
   *
   * @param composeFiles - `-f` list used at up
   * @param cwd - Compose directory (`docker/`)
   * @param env - Stack env merged into the process env for compose
   */
  readonly composeStop?: (
    composeFiles: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string>>,
  ) => void;
  /**
   * Poll compose service health (injectable). Default: {@link watchComposeHealth}.
   *
   * @param options - Compose files, cwd, env, optional per-service updates
   */
  readonly composeHealth?: (options: {
    readonly files: readonly string[];
    readonly cwd: string;
    readonly env: Record<string, string>;
    readonly onUpdate?: (service: string, status: DevStatus) => void;
  }) => Promise<Map<string, DevStatus>>;
  /**
   * Injectable `docker compose ps` runner for live health polls
   * ({@link startComposeHealthWatch} / keyboard refresh). Default: real
   * `docker`. When {@link DevOptions.composeHealth} is set and this is
   * omitted, live polls return empty (unit tests never shell out).
   *
   * @param args - Args after `docker` (e.g. `compose -f … ps -a …`)
   * @param cwd - Compose directory
   * @param env - Stack env merged into the process env
   */
  readonly composeHealthRun?: (
    args: readonly string[],
    cwd: string,
    env: Record<string, string>,
  ) => Promise<string>;
  /**
   * Regenerate client types (injectable).
   *
   * @param appUrl - App base URL
   */
  readonly regenClient?: (appUrl: string) => Promise<void>;
  /** Serve Console (injectable). */
  readonly serveConsole?: (port: number) => Promise<DevConsoleHandle>;
  /**
   * Force (`true`) or skip (`false`) Console Vite HMR. Default: attach
   * on an okengine source checkout so `dev:keel` does not need `bun run build`.
   */
  readonly consoleVite?: boolean;
  /**
   * Injectable Console Vite sidecar (tests). Default: {@link startConsoleVite}.
   *
   * @param options - Kernel port + listen preference
   */
  readonly startConsoleVite?: (options: StartConsoleViteOptions) => Promise<ConsoleViteHandle>;
  /**
   * Serve MCP against the live Console context (injectable).
   * Default: {@link serveMcp} on :6535.
   */
  readonly serveMcp?: (options: DevServeMcpOptions) => Promise<DevMcpHandle>;
  /**
   * Serve the read-only docs MCP (injectable).
   * Default: {@link serveDocsMcp} on :6536. Boot failure skips the surface —
   * docs search must never take `oke dev` down.
   */
  readonly serveDocsMcp?: (options: DevServeDocsMcpOptions) => Promise<DevMcpHandle>;
  /**
   * Boot + serve the app entry (injectable).
   * Default: spawn `bun --hot` on the shipped {@link ./dev-app-runner.ts}
   * (import → `app.boot()` → `createBunRuntime().serve`) so Bun soft-reloads
   * app code while preserving the listen socket.
   */
  readonly startApp?: (entry: string, env: Record<string, string>) => Promise<DevAppHandle>;
  /**
   * Override stdin TTY detection (tests). Default: `process.stdin.isTTY`.
   */
  readonly stdinIsTTY?: boolean;
  /**
   * Probe Docker daemon availability (injectable). Default: `docker info`.
   * Skipped on {@link dryRun}; when {@link composeUp} is injected and this is
   * omitted, the probe is a no-op (unit tests never shell out).
   */
  readonly assertDocker?: () => Promise<void>;
}

/** Result of a dry-run / prepared / live-but-detached dev session. */
export interface DevPlan {
  readonly entry: string;
  readonly appPort: number;
  readonly consolePort: number;
  readonly mcpPort: number;
  readonly docsMcpPort: number;
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
  /** Reassigned to {@link createAnchoredBoard} wrap after the status board paints. */
  let write: (text: string) => void = options.write ?? ((t) => process.stdout.write(t));
  const chromeWrite = (t: string) => write(formatCliChrome(t));
  /**
   * `docker compose ps` runner for live / default health polls.
   * Explicit inject wins; otherwise a `composeHealth` inject implies tests —
   * never shell out to a real `docker` binary.
   */
  const composeHealthRun =
    options.composeHealthRun ??
    (options.composeHealth ? async (): Promise<string> => "[]" : undefined);
  const previousWarn = console.warn;
  const bootNotices: string[] = [];
  const noticeSeen = new Set<string>();
  let chromeReady = false;
  console.warn = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (/^oke boot:/i.test(msg.trim())) {
      const key = msg.trim().replace(/\s+/g, " ");
      if (noticeSeen.has(key)) return;
      noticeSeen.add(key);
      if (chromeReady) write(formatBootWarn(msg.trim()));
      else bootNotices.push(msg.trim());
      return;
    }
    previousWarn.apply(console, args as Parameters<typeof console.warn>);
  };
  const restoreWarn = () => {
    console.warn = previousWarn;
  };
  const cwd = options.cwd ?? process.cwd();

  // One-shot `.adopt()` barrel regen for the session — real file on disk
  // (`src/flows/generated.ts`), written atomically (tmp → rename) before the
  // entry is resolved/imported below so a freshly-added flows unit is
  // adoptable without a hand edit. Best-effort like `syncDevSchema` below:
  // a project with no `src/flows` yet (or a synthetic test tree) never
  // blocks the dev session.
  const syncAdoptBarrel =
    options.syncAdoptBarrel ??
    (async (root: string) => {
      const { generateAdoptBarrel, writeAdoptBarrel } =
        await import("../compiler/generate-adopt.ts");
      const { source, units } = await generateAdoptBarrel({ rootDir: root });
      await writeAdoptBarrel(root, source);
      return units;
    });
  try {
    await syncAdoptBarrel(cwd);
  } catch (err) {
    // Best-effort: boot-time assertAdoptBarrelFresh (rootDir opt-in) is the real gate.
    // Still surface so a broken generator is not fully silent in the boot log.
    write(
      formatStatusLine(
        `.adopt() barrel sync skipped — ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  const preferredApp = options.appPort ?? Number(Bun.env.PORT ?? APP_PORT);
  const preferredConsole = options.consolePort ?? CONSOLE_PORT;
  const preferredMcp = options.mcpPort ?? MCP_PORT;
  const preferredDocsMcp = options.docsMcpPort ?? DOCS_MCP_PORT;
  // Explicit overrides (incl. `0` ephemeral) skip probing; otherwise +1 until free.
  const ports =
    options.appPort !== undefined ||
    options.consolePort !== undefined ||
    options.mcpPort !== undefined ||
    options.docsMcpPort !== undefined
      ? {
          app: preferredApp,
          console: preferredConsole,
          mcp: preferredMcp,
          docsMcp: preferredDocsMcp,
        }
      : await resolveDevPorts({
          app: preferredApp,
          console: preferredConsole,
          mcp: preferredMcp,
          docsMcp: preferredDocsMcp,
        });
  const appPort = ports.app;
  const consolePort = ports.console;
  const mcpPort = ports.mcp;
  const docsMcpPort = ports.docsMcp;
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
    restoreWarn();
    return { code: 1 };
  }

  // Fail fast when the Docker daemon is down (skip on dryRun / injected compose).
  if (!options.dryRun) {
    const probe = options.assertDocker ?? (options.composeUp ? async () => {} : assertDockerDaemon);
    try {
      await probe();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      restoreWarn();
      return { code: 1 };
    }
  }

  // Paint chrome immediately so docker/vault work is never a blank 6s wait.
  let okeVersion = "0.0.0";
  try {
    const pkg = (await Bun.file(resolve(import.meta.dir, "../../package.json")).json()) as {
      version?: string;
    };
    if (typeof pkg.version === "string") okeVersion = pkg.version;
  } catch {
    // Inconsequential: banner version only — shipped binaries may not sit next to package.json.
  }
  const earlyProfile = resolveDevProfile({ docker: true, nodeEnv: "development" });
  write(
    formatDevBanner({
      profile: earlyProfile,
      runtimeEnv: resolveDevRuntimeEnv(earlyProfile),
      system: formatHeroSystemLine(),
      version: okeVersion,
    }),
  );
  /** Ephemeral compose/vault/health/AI lines — cleared before the final board. */
  const bootProgress: BootProgress = createBootProgress(write);

  let stackRoles: string[] | null = null;
  let composeFiles: string[] | null = null;
  let stackEnv: Record<string, string> | null = null;
  /** Set only after a successful `compose up` — torn down on SIGINT / stop. */
  let dockerStarted: {
    files: readonly string[];
    cwd: string;
    env: Record<string, string>;
    aiServiceName?: string;
  } | null = null;
  let stackSqlDriver = "postgres";
  let stackKvDriver = "redis";
  /** Printed after the hero so Docker ports sit under the Starting column. */
  let pendingStackSummary: {
    readonly project: string;
    readonly services: StackSummaryService[];
    readonly appDrivers: readonly string[];
  } | null = null;
  /** Background AI model poller — cancelled in `stop()`. */
  let stopAiModelWatch: (() => void) | null = null;
  /** Session compose health poller — cancelled in `stop()`. */
  let stopComposeHealthWatch: (() => void) | null = null;
  /** Latest compose ps -a statuses (service name → ●). */
  let liveComposeHealth = new Map<string, DevStatus>();
  /** Start after hero/stack chrome so status lines land in the right place. */
  let pendingAiModelWatch: {
    readonly url: string;
    readonly model: string;
    readonly kind: "openai-compatible";
  } | null = null;
  /** Hero AI status dot (yellow while model loads). */
  let heroAiStatus: DevStatus | undefined;
  /** Compose AI service name when `images.ai` is pinned — undefined for cloud AI. */
  let stackAiServiceName: string | undefined;
  let loadedConfig: Awaited<ReturnType<typeof loadOkeConfig>>["config"] | null = null;
  try {
    loadedConfig = (await loadOkeConfig(cwd)).config;
  } catch (err) {
    loadedConfig = null;
    const msg = err instanceof Error ? err.message : String(err);
    // Missing config is common for injectable/`--images` trees; surface parse bugs only.
    if (!/no oke\.config\.ts found/i.test(msg)) {
      write(formatStatusLine(`oke.config.ts load skipped — ${msg}`));
    }
  }

  {
    let images = options.images;
    if (!images) {
      if (!loadedConfig) {
        try {
          const loaded = await loadOkeConfig(cwd);
          loadedConfig = loaded.config;
          images = resolveImages(loaded.config);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          restoreWarn();
          return { code: 1 };
        }
      } else {
        images = resolveImages(loadedConfig);
      }
    } else if (!loadedConfig) {
      try {
        loadedConfig = (await loadOkeConfig(cwd)).config;
      } catch (err) {
        loadedConfig = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/no oke\.config\.ts found/i.test(msg)) {
          write(formatStatusLine(`oke.config.ts load skipped — ${msg}`));
        }
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
      layout: "single",
      includeApp: false,
      composeDir,
      instanceId,
      ...(reusedCreds ? { credentials: reusedCreds } : {}),
      ...(controls ? { controls } : {}),
      host: "127.0.0.1",
    });
    // User-owned overrides — include only if the file already exists.
    composeFiles = [];
    for (const f of derived.composeFiles) {
      if (f === "compose.override.yml" || f === "docker-compose.override.yml") {
        if (await Bun.file(resolve(dockerOut, f)).exists()) composeFiles.push(f);
        continue;
      }
      composeFiles.push(f);
    }
    stackEnv = { ...derived.stackEnv };

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
    const stackAiModel =
      stackEnv.OKE_AI_MODEL?.trim() || process.env.OKE_AI_MODEL?.trim() || undefined;
    pendingStackSummary = {
      project: `oke-${appSlug}`,
      services: derived.specs.flatMap((spec) => [
        {
          label: roleLabel(spec.role),
          hostPort: spec.hostPort,
          serviceName: spec.serviceName,
          status: "pending" as const,
          ...(spec.role === "ai" && stackAiModel ? { detail: stackAiModel } : {}),
        },
        ...resolveExtraPorts(spec, { images, instanceId }).map((p) => ({
          label: extraLabel(spec.role, p.containerPort),
          hostPort: p.hostPort,
          serviceName: spec.serviceName,
          status: "pending" as const,
        })),
      ]),
      appDrivers,
    };

    if (!options.dryRun) {
      try {
        await writeDerivedFiles(derived, dockerOut, {
          writeStackEnv: true,
        });
        const up =
          options.composeUp ??
          (async (files, dir) => {
            const args = [
              "compose",
              ...files.flatMap((f) => ["-f", f]),
              "up",
              "-d",
              "--remove-orphans",
            ];
            const proc = Bun.spawn(["docker", ...args], {
              cwd: dir,
              stdout: "pipe",
              stderr: "pipe",
              env: { ...process.env, ...stackEnv! },
            });
            const [stdout, stderr, code] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
              proc.exited,
            ]);
            if (code !== 0) {
              const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
              throw new Error(
                `oke dev: docker compose exited ${code}` + (detail ? `\n${detail}` : ""),
              );
            }
          });
        bootProgress.set("compose", formatStatusLine("docker compose up…", undefined, "pending"));
        // Compose files live under docker/; cwd for compose is that directory.
        await up(composeFiles, dockerOut);
        bootProgress.set("compose", formatStatusLine("docker compose up", undefined, "ready"));
        // Remember for SIGINT / terminal close — `stop` keeps volumes (not `down -v`).
        dockerStarted = {
          files: composeFiles,
          cwd: dockerOut,
          env: { ...stackEnv! },
          aiServiceName: derived.specs.find((s) => s.role === "ai")?.serviceName,
        };

        // Stream compose health until infra is up (AI may stay pending — model load).
        const aiServiceName = derived.specs.find((s) => s.role === "ai")?.serviceName;
        stackAiServiceName = aiServiceName;
        const labelForService = (serviceName: string): string => {
          const spec = derived.specs.find((s) => s.serviceName === serviceName);
          return spec ? roleLabel(spec.role) : serviceName;
        };
        const onHealthUpdate = (service: string, status: DevStatus) => {
          const label = labelForService(service);
          const text =
            status === "ready"
              ? `${label} ready`
              : status === "error"
                ? `${label} unhealthy`
                : `${label} starting…`;
          bootProgress.set(`svc:${service}`, formatStatusLine(text, undefined, status));
        };
        const healthByService = options.composeHealth
          ? await options.composeHealth({
              files: composeFiles,
              cwd: dockerOut,
              env: dockerStarted.env,
              onUpdate: onHealthUpdate,
            })
          : await (
              await import("../docker/compose-health.ts")
            ).watchComposeHealth({
              files: composeFiles,
              cwd: dockerOut,
              env: dockerStarted.env,
              run: composeHealthRun,
              timeoutMs: 20_000,
              isDone: (map) => {
                // Empty ps (compose just-created / injectable gap): do not spin 20s.
                if (map.size === 0) return true;
                return [...map.entries()].every(
                  ([name, s]) => name === aiServiceName || s === "ready" || s === "error",
                );
              },
              onUpdate: onHealthUpdate,
            });
        liveComposeHealth = healthByService;
        if (pendingStackSummary) {
          pendingStackSummary = {
            ...pendingStackSummary,
            services: pendingStackSummary.services.map((svc) => ({
              ...svc,
              status: svc.serviceName
                ? (healthByService.get(svc.serviceName) ?? svc.status ?? "pending")
                : (svc.status ?? "pending"),
            })),
          };
        }

        // Compose no longer ships local AI recipes — BYO `OKE_AI_URL` watch
        // is armed below after stackEnv / process.env are known.
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        console.error("oke dev: Docker Compose failed — fix compose and retry");
        restoreWarn();
        return { code: 1 };
      }
    }
  }

  const plan: DevPlan = {
    entry: resolve(cwd, entry),
    appPort,
    consolePort,
    mcpPort,
    docsMcpPort,
    stackRoles,
    composeFiles,
    stackEnv,
  };

  const heroAiModel =
    stackEnv?.OKE_AI_MODEL?.trim() || process.env.OKE_AI_MODEL?.trim() || undefined;
  // BYO OpenAI-compatible server (LM Studio, llama.cpp, …) — poll readiness
  // without blocking boot. Registry cloud (OpenRouter) has no OKE_AI_URL.
  if (!pendingAiModelWatch) {
    const byoUrl =
      stackEnv?.OKE_AI_URL?.trim() || process.env.OKE_AI_URL?.trim() || undefined;
    const byoModel = heroAiModel;
    if (byoUrl && byoModel) {
      pendingAiModelWatch = {
        url: byoUrl,
        model: byoModel,
        kind: "openai-compatible",
      };
    }
  }
  // OpenAI-compatible model load can outlive compose health — default AI ● to pending.
  if (pendingAiModelWatch && heroAiStatus === undefined) {
    heroAiStatus = "pending";
  }
  const heroSnapshot = buildDevHeroSnapshot({
    config: loadedConfig,
    docker: true,
    sqlDriver: stackSqlDriver,
    kvDriver: stackKvDriver,
    aiModel: heroAiModel,
    aiStatus: heroAiStatus,
    version: okeVersion,
    nodeEnv: "development",
  });
  const aiDriverLabel = (() => {
    const detail = heroSnapshot.elements.find((r) => r.element === "ai")?.detail ?? "—";
    if (detail === "—" || detail === "") return detail;
    return detail.split(" · ")[0] ?? detail;
  })();

  const worstStatus = (statuses: readonly (DevStatus | undefined)[]): DevStatus | undefined => {
    const present = statuses.filter((s): s is DevStatus => s !== undefined);
    if (present.length === 0) return undefined;
    if (present.includes("error")) return "error";
    if (present.includes("pending")) return "pending";
    if (present.includes("idle")) return "idle";
    return "ready";
  };

  const elementStatusFromHealth = (
    element: string,
    aiStatus: DevStatus | undefined,
  ): DevStatus | undefined => {
    const h = liveComposeHealth;
    if (h.size === 0) return element === "ai" ? aiStatus : undefined;
    const one = (name: string) => h.get(name);
    switch (element) {
      case "ai": {
        // Cloud / host AI has no compose service — ignore orphaned exited
        // containers left over after `images.ai` was removed.
        if (!stackAiServiceName) return aiStatus;
        const container = one(stackAiServiceName);
        if (container === "error") return "error";
        return aiStatus ?? container;
      }
      case "vault":
        return one("vault");
      case "signal":
      case "gate":
        return one("store-kv");
      case "channel":
        return one("channel-email");
      case "clock":
        return one("store-sql");
      case "store":
        return worstStatus([
          one("store-sql"),
          one("store-kv"),
          one("store-files"),
          one("store-index"),
        ]);
      default:
        return undefined;
    }
  };

  let consoleState: ConsoleState | null = null;
  let claimConsoleUrl: string | undefined;

  const paintBootBoard = (aiStatus: DevStatus | undefined) => {
    const aiSt = aiStatus ?? heroAiStatus;
    const elements = heroSnapshot.elements.map((row) => {
      const fromHealth = elementStatusFromHealth(row.element, aiSt);
      const st =
        fromHealth ?? row.status ?? (row.detail === "—" || row.detail === "" ? "idle" : "ready");
      if (row.element !== "ai") {
        return fromHealth ? { ...row, status: st } : row;
      }
      let detail = aiDriverLabel;
      if (detail !== "—" && heroAiModel) {
        const phase =
          st === "ready" || st === "idle"
            ? null
            : st === "error"
              ? stackAiServiceName && liveComposeHealth.get(stackAiServiceName) === "error"
                ? "stopped"
                : "error"
              : "loading";
        detail = phase
          ? `${aiDriverLabel} · ${heroAiModel} · ${phase}`
          : `${aiDriverLabel} · ${heroAiModel}`;
      }
      return { ...row, status: st, detail };
    });
    const elementsBlock = formatDevHeroDetails({ elements });
    const stackBlock = pendingStackSummary
      ? formatStackSummary({
          project: pendingStackSummary.project,
          services: pendingStackSummary.services.map((svc) => {
            const fromHealth = svc.serviceName ? liveComposeHealth.get(svc.serviceName) : undefined;
            let status = fromHealth ?? svc.status ?? "pending";
            let detail = svc.detail;
            if (stackAiServiceName && svc.serviceName === stackAiServiceName) {
              if (fromHealth === "error") {
                status = "error";
                detail = heroAiModel ? `${heroAiModel} · stopped` : "stopped";
              } else if (aiSt !== undefined) {
                status = aiSt === "ready" && fromHealth === "pending" ? "pending" : aiSt;
                detail = !heroAiModel
                  ? detail
                  : status === "ready"
                    ? heroAiModel
                    : `${heroAiModel} · ${status === "error" ? "error" : "loading"}`;
              }
            }
            return { ...svc, status, ...(detail !== undefined ? { detail } : {}) };
          }),
          appDrivers: pendingStackSummary.appDrivers,
        })
      : "";
    const claim =
      consoleState && !consoleState.setupClosed
        ? formatClaimNote(consoleState.claim.code, termColorEnabled(), {
            ...(claimConsoleUrl !== undefined ? { consoleUrl: claimConsoleUrl } : {}),
          })
        : "";
    return `${elementsBlock}${stackBlock}${claim}`;
  };

  // Drop ephemeral progress — final elements + Docker board replaces it.
  bootProgress.clear();
  const bootBoard = createAnchoredBoard(write);
  bootBoard.paint(paintBootBoard(heroAiStatus));
  // Track lines printed below the board so live ● repaints stay anchored.
  write = bootBoard.wrapWrite(write);

  if (options.dryRun) {
    bootBoard.stop();
    restoreWarn();
    return { code: 0, plan };
  }

  let boardPaused = false;
  const repaintBoard = (aiStatus?: DevStatus): void => {
    if (boardPaused) return;
    bootBoard.paint(paintBootBoard(aiStatus ?? heroAiStatus));
  };

  if (pendingAiModelWatch) {
    const target = pendingAiModelWatch;
    pendingAiModelWatch = null;
    const { startAiModelWatch } = await import("../docker/ai-model-status.ts");
    let resolveFirstAi: (() => void) | undefined;
    const firstAiPaint = new Promise<void>((resolve) => {
      resolveFirstAi = resolve;
    });
    let sawAiPaint = false;
    stopAiModelWatch = startAiModelWatch({
      url: target.url,
      model: target.model,
      kind: target.kind,
      onStatus: (_line, status) => {
        const st = devStatusFromAiPhase(status.phase);
        // Container stopped wins over model-phase "loading".
        if (
          stackAiServiceName &&
          liveComposeHealth.get(stackAiServiceName) === "error"
        ) {
          heroAiStatus = "error";
          repaintBoard("error");
          if (!sawAiPaint) {
            sawAiPaint = true;
            resolveFirstAi?.();
          }
          return;
        }
        heroAiStatus = st;
        // Status ● lives on the board above Logs — not in the log stream.
        repaintBoard(st);
        if (!sawAiPaint) {
          sawAiPaint = true;
          resolveFirstAi?.();
        }
      },
    });
    // Let the first probe repaint AI ● (yellow loading) before we print below.
    await Promise.race([firstAiPaint, Bun.sleep(2_500)]);
  }

  /** Snapshot keys we mutate so `stop()` can leave the parent shell clean. */
  const processEnvSnapshot = new Map<string, string | undefined>();
  const setProcessEnv = (key: string, value: string): void => {
    if (!processEnvSnapshot.has(key)) processEnvSnapshot.set(key, process.env[key]);
    process.env[key] = value;
  };
  const restoreProcessEnv = (): void => {
    for (const [key, prev] of processEnvSnapshot) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    processEnvSnapshot.clear();
  };

  // Hydrate parent process.env so schema sync / seed / Console see compose URLs
  // (Backend child gets the same overlay via `env` below). Restored on stop.
  if (stackEnv) {
    for (const [key, value] of Object.entries(stackEnv)) {
      setProcessEnv(key, value);
    }
    setProcessEnv("OKE_DOCKER", "1");
    setProcessEnv("OKE_SQL_DRIVER", stackSqlDriver);
    setProcessEnv("OKE_KV_DRIVER", stackKvDriver);
  }

  // One-shot schema sync for the compose (`dev`) profile: emits
  // schema.drizzle.ts for the active dialect, then pushes via drizzle-kit.
  let schemaPushOk = options.noDbPush === true;
  if (!options.noDbPush) {
    const { syncDevSchema } = await import("./dev-schema-sync.ts");
    const configEnv = "dev" as const;
    try {
      const injectedPush = options.dbPush;
      const result = await syncDevSchema(cwd, configEnv, {
        write: chromeWrite,
        quietComposeReady: true,
        ...(injectedPush ? { pushFn: async (projectCwd: string) => injectedPush(projectCwd) } : {}),
      });
      write(
        formatStatusLine(
          `oke db push (dev · ${result.dialect}) ${result.code === 0 ? "ok" : "failed"}`,
        ),
      );
      schemaPushOk = result.code === 0;
    } catch (err) {
      write(await formatDevSchemaSyncFailure(cwd, err, "boot"));
    }
  }

  // Vault gaps before seed / app — missing contracts (e.g. OPENROUTER_API_KEY).
  {
    const { maybeAskVaultGaps } = await import("./ask-vault-gaps.ts");
    const vaultCode = await maybeAskVaultGaps({
      cwd,
      entry,
      write,
      stdinIsTTY: options.stdinIsTTY ?? process.stdin.isTTY,
    });
    if (vaultCode !== 0) {
      bootBoard.stop();
      restoreProcessEnv();
      restoreWarn();
      return { code: vaultCode };
    }
  }

  // First-time seed ask only after a successful push (needs live schema).
  if (schemaPushOk && !options.noDbPush) {
    const { maybeAskSeed } = await import("./ask-seed.ts");
    await maybeAskSeed({
      cwd,
      env: "dev",
      write,
      stdinIsTTY: options.stdinIsTTY ?? process.stdin.isTTY,
    });
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
    /** Backend child — parent Console owns process-local boot notices. */
    OKE_SUPPRESS_BOOT_WARN: "1",
  };
  setProcessEnv("OKE_DEV_REQUEST_LOG", "1");

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
      // Inconsequential while watching: mid-edit parse failures are expected on every
      // keystroke — keep the last good Manifest. Logging here would flood the Logs pane.
    }
  }

  /** Host → Console WideEvent ingest secret (live Traces bridge). */
  const runsIngestSecret = crypto.randomUUID();

  let consoleVite: ConsoleViteHandle | null = null;
  // Dry-run already returned above — Vite is a live sidecar, never planned.
  const wantConsoleVite =
    options.consoleVite === true ||
    (options.consoleVite !== false &&
      options.serveConsole === undefined &&
      shouldAttachConsoleVite());
  if (wantConsoleVite) {
    const startVite = options.startConsoleVite ?? startConsoleVite;
    try {
      consoleVite = await startVite({
        consolePort,
        occupied: new Set([appPort, consolePort, mcpPort, docsMcpPort].filter((p) => p !== 0)),
      });
      write(formatStatusLine("Console UI hot reload"));
    } catch (err) {
      write(
        formatStatusLine(
          `Console UI hot reload skipped — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
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
        okeConfig: loadedConfig,
        // CLI paints the claim on the live board — do not dump it to raw stdout.
        silentClaim: options.silentClaim ?? true,
        runsIngestSecret,
        ...(options.secret !== undefined ? { secret: options.secret } : {}),
        ...(seedManifest !== undefined && seedManifest !== null ? { manifest: seedManifest } : {}),
        ...(consoleVite ? { spaProxy: { origin: consoleVite.origin } } : {}),
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

  const serveDocsMcpSurface =
    options.serveDocsMcp ??
    (async (docsOptions) => {
      const { serveDocsMcp } = await import("../mcp/docs-server.ts");
      const server = await serveDocsMcp({
        port: docsOptions.port,
        hostname: docsOptions.hostname ?? "127.0.0.1",
      });
      write(formatServiceLine("Docs MCP", `http://127.0.0.1:${server.port}`));
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
      } catch (err) {
        // App may not be ready yet on first tick — still surface so a stuck regen is visible.
        write(
          formatStatusLine(
            `oke-client.d.ts regen skipped — ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

  // Console before host so ingest URL/secret are real when the child boots.
  const consoleServer = await serveConsole(consolePort);
  const boundConsolePort = consoleServer.port ?? consolePort;
  consoleState = consoleServer.console?.state ?? null;
  claimConsoleUrl = `http://127.0.0.1:${boundConsolePort}`;
  if (consoleState && !consoleState.setupClosed && process.stdout.isTTY !== true) {
    repaintBoard();
  }
  env.OKE_DEV_HERO_CONSOLE = `http://127.0.0.1:${boundConsolePort}`;
  const ingestSecret = consoleServer.console?.state.runsIngestSecret;
  if (ingestSecret) {
    env[RUNS_INGEST_URL_ENV] = `http://127.0.0.1:${boundConsolePort}${RUNS_INGEST_PATH}`;
    env[RUNS_INGEST_SECRET_ENV] = ingestSecret;
  }

  const app = await startApp(plan.entry, env);
  const boundAppPort = app.port ?? appPort;

  let mcpServer: DevMcpHandle | null = null;
  let secret: string | null = null;
  let sessions: SessionStore | null = null;
  let attachedHost: { readonly stop: () => Promise<void> } | null = null;

  if (consoleServer.console) {
    const state = consoleServer.console.state;
    consoleState = state;
    try {
      const { attachHostToConsole } = await import("./attach-host-console.ts");
      attachedHost = await attachHostToConsole({
        entry: plan.entry,
        cwd,
        state,
        ...(ingestSecret
          ? {
              runsBridge: {
                url: `http://127.0.0.1:${boundConsolePort}${RUNS_INGEST_PATH}`,
                secret: ingestSecret,
              },
            }
          : {}),
      });
    } catch (err) {
      write(
        formatStatusLine(
          `host attach skipped — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
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

  // Docs MCP is independent of Console state — read-only, no sessions/secret.
  // Boot failure (missing docs content, busy port) skips it, never kills dev.
  let docsMcpServer: DevMcpHandle | null = null;
  try {
    docsMcpServer = await serveDocsMcpSurface({ port: docsMcpPort, hostname: "127.0.0.1" });
  } catch (err) {
    write(
      formatStatusLine(`Docs MCP skipped — ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  const boundMcpPort = mcpServer?.port ?? mcpPort;
  const mcpUrl = mcpServer?.url ?? null;
  const boundDocsMcpPort = docsMcpServer?.port ?? docsMcpPort;
  const docsMcpUrl = docsMcpServer?.url ?? null;

  const appUrl = app.url?.origin ?? `http://127.0.0.1:${boundAppPort}`;
  await regen(appUrl);

  const dbPush =
    options.dbPush ??
    (async (projectCwd: string) => {
      const configPath = await resolveDrizzleConfigPath(projectCwd);
      return runPush(configPath, (t) => write(t), {
        cwd: projectCwd,
        env: "dev",
      });
    });

  let lastSchemaFilename = "";
  const autoPushRunner = createDebouncedRunner(async () => {
    if (!autoPushEnabled) return;
    options.onDbAutoPush?.(lastSchemaFilename);
    write(formatStatusLine("oke db push (schema change)"));
    try {
      await dbPush(cwd);
    } catch (err) {
      // Dev-loop stays up (next save retries) — but definition errors must not look like a quiet skip.
      write(await formatDevSchemaSyncFailure(cwd, err, "watch"));
    }
  });

  const paintReadyChrome = (): void => {
    const tty = process.stdout.isTTY === true;
    if (tty) {
      write(clearTerminalScreen());
      bootBoard.reset();
      write(
        formatDevBanner({
          profile: earlyProfile,
          runtimeEnv: resolveDevRuntimeEnv(earlyProfile),
          system: formatHeroSystemLine(),
          version: okeVersion,
          phase: "ready",
        }),
      );
    }
    bootBoard.paint(paintBootBoard(heroAiStatus));
    for (const notice of bootNotices) {
      write(formatBootWarn(notice));
    }
    bootNotices.length = 0;
    write(
      formatBoundSurfaces({
        appUrl: `http://127.0.0.1:${boundAppPort}`,
        consoleUrl: `http://127.0.0.1:${boundConsolePort}`,
        mcpUrl: mcpServer ? `http://127.0.0.1:${boundMcpPort}` : null,
        docsMcpUrl: docsMcpServer ? `http://127.0.0.1:${boundDocsMcpPort}` : null,
      }),
    );
    write(formatDevLogSeparator());
    chromeReady = true;
  };
  paintReadyChrome();

  // Live ● after the ready board — mid-boot health ticks were rewriting
  // elements/Docker on top of db-push lines and tearing the claim box.
  if (dockerStarted && composeFiles) {
    const { startComposeHealthWatch } = await import("../docker/compose-health.ts");
    const started = dockerStarted;
    stopComposeHealthWatch = startComposeHealthWatch({
      files: started.files,
      cwd: started.cwd,
      env: started.env,
      run: composeHealthRun,
      intervalMs: 2_000,
      onChange: (map) => {
        liveComposeHealth = map;
        if (map.get("ai") === "error") heroAiStatus = "error";
        repaintBoard();
      },
    });
  }

  const watchFs: DevWatchFn =
    options.watchFs ?? ((path, watchOptions, listener) => watch(path, watchOptions, listener));
  const watcher = watchFs(resolve(cwd, "src"), { recursive: true }, (_event, filename) => {
    const rel = (filename?.toString() ?? "").replace(/\\/g, "/");
    if (isFlowsTreeWatchPath(rel)) {
      void syncAdoptBarrel(cwd);
    }
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

  let stopDevControls: (() => void) | null = null;

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    restoreWarn();
    stopDevControls?.();
    stopDevControls = null;
    stopAiModelWatch?.();
    stopAiModelWatch = null;
    stopComposeHealthWatch?.();
    stopComposeHealthWatch = null;
    bootBoard.stop();
    autoPushRunner.cancel();
    watcher.close();
    const host = attachedHost;
    attachedHost = null;
    void host?.stop();
    void Promise.resolve(app.stop());
    consoleServer.stop();
    mcpServer?.stop();
    docsMcpServer?.stop();
    const vite = consoleVite;
    consoleVite = null;
    void vite?.stop();
    void clearDevSessionLock(cwd);
    if (dockerStarted) {
      const started = dockerStarted;
      dockerStarted = null;
      const stopCompose =
        options.composeStop ??
        ((files, dir, env) => {
          const args = ["compose", ...files.flatMap((f) => ["-f", f]), "stop"];
          const result = Bun.spawnSync(["docker", ...args], {
            cwd: dir,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, ...env },
          });
          if (result.exitCode !== 0) {
            console.error(
              `oke dev: docker compose stop exited ${result.exitCode ?? "unknown"} (containers may still be running)`,
            );
          }
        });
      try {
        stopCompose(started.files, started.cwd, started.env);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
    restoreProcessEnv();
  };

  const onSignal = () => {
    stop();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  // Terminal close often delivers SIGHUP rather than SIGINT.
  process.on("SIGHUP", onSignal);

  const session: DevSession = {
    plan: {
      ...plan,
      appPort: boundAppPort,
      consolePort: boundConsolePort,
      mcpPort: boundMcpPort,
      docsMcpPort: boundDocsMcpPort,
    },
    stop,
    appPort: boundAppPort,
    consolePort: boundConsolePort,
    mcpPort: boundMcpPort,
    mcpUrl,
    docsMcpPort: boundDocsMcpPort,
    docsMcpUrl,
    secret,
    sessions,
    consoleState,
  };

  // Record ownership so a later `oke` TUI can attach without spawning a second stack.
  await writeDevSessionLock(cwd, {
    pid: process.pid,
    ports: {
      app: boundAppPort,
      console: boundConsolePort,
      mcp: boundMcpPort,
      docsMcp: boundDocsMcpPort,
    },
    startedAt: new Date().toISOString(),
    cwd,
  });

  if (options.onReady) await options.onReady(session);

  // Keyboard controls (docker + TTY): Ink replaces raw-mode stdin.
  if (keepAlive && dockerStarted && (options.stdinIsTTY ?? process.stdin.isTTY)) {
    const started = dockerStarted;
    const syncComposeBoard = async (): Promise<void> => {
      const { readComposeHealth } = await import("../docker/compose-health.ts");
      liveComposeHealth = await readComposeHealth({
        files: started.files,
        cwd: started.cwd,
        env: started.env,
        run: composeHealthRun,
      });
      if (
        started.aiServiceName &&
        liveComposeHealth.get(started.aiServiceName) === "error"
      ) {
        heroAiStatus = "error";
      }
      repaintBoard();
    };
    const refreshChrome = async (): Promise<void> => {
      await syncComposeBoard();
      paintReadyChrome();
    };
    const waitComposeReady = async (): Promise<void> => {
      const { watchComposeHealth } = await import("../docker/compose-health.ts");
      const aiServiceName = started.aiServiceName;
      liveComposeHealth = await watchComposeHealth({
        files: started.files,
        cwd: started.cwd,
        env: started.env,
        run: composeHealthRun,
        timeoutMs: 20_000,
        isDone: (map) => {
          if (map.size === 0) return true;
          return [...map.entries()].every(
            ([name, s]) => name === aiServiceName || s === "ready" || s === "error",
          );
        },
      });
      if (aiServiceName && liveComposeHealth.get(aiServiceName) === "error") {
        heroAiStatus = "error";
      }
    };

    const composeAction = async (action: DevComposeControlAction): Promise<void> => {
      const files = started.files;
      const finalArgs =
        action === "up"
          ? ["compose", ...files.flatMap((f) => ["-f", f]), "up", "-d"]
          : ["compose", ...files.flatMap((f) => ["-f", f]), action];
      const proc = Bun.spawn(["docker", ...finalArgs], {
        cwd: started.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...started.env },
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) {
        const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        throw new Error(`docker compose ${action} exited ${code}` + (detail ? `\n${detail}` : ""));
      }
      if (action === "up") await waitComposeReady();
      await syncComposeBoard();
    };

    try {
      const { launchDevLiveControls } = await import("./tui/DevLive.tsx");
      await launchDevLiveControls({
        onRefresh: () => refreshChrome(),
        onSeed: async () => {
          const { runSlashCli } = await import("./tui/slash-run.ts");
          boardPaused = true;
          const lines: string[] = [];
          try {
            const code = await runSlashCli(cwd, ["db", "seed", "--force"], (line) => {
              lines.push(line);
              write(line);
            });
            if (code === 0) return;
            const last = [...lines]
              .reverse()
              .map((line) => line.trim())
              .find((line) => line.length > 0 && !line.startsWith("✗") && !line.startsWith("$"));
            throw new Error(last || "oke db seed failed");
          } finally {
            boardPaused = false;
          }
        },
        onComposeUp: () => composeAction("up"),
        onComposeStop: () => composeAction("stop"),
        onQuit: () => {
          stop();
          process.exit(0);
        },
      });
      // Esc / unmount without q — still tear down.
      stop();
    } catch {
      // Inconsequential: Ink/TUI is optional chrome — fall back to keep-alive without keyboard.
      await new Promise(() => {});
    }
    return { code: 0, plan: session.plan, session };
  }

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
 * Environmental syncDevSchema throws that are fine to soft-skip in the
 * compose (`dev`) boot path — no Store / no docker images yet, etc.
 *
 * @param message - Caught error message
 */
function isBenignDevSchemaEnvSkip(message: string): boolean {
  return (
    message.startsWith("docker mode: oke.config.ts not found") ||
    message.startsWith("docker mode: no images configured")
  );
}

/**
 * Whether a caught sync/push error is a schema.decl definition failure
 * (import evaluation, emit, duplicate tables, bad `.references()`, …).
 *
 * Message text alone is insufficient — emit-time bugs often look like bare
 * TypeErrors (`target.tableName`) — so also inspect the stack for declare /
 * emit frames.
 *
 * @param err - Caught value
 * @param declarePath - Resolved schema.decl path for this project
 */
function isSchemaDeclDefinitionError(err: unknown, declarePath: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  const blob = `${msg}\n${stack}`;
  if (/failed to load schema declare|store schema:|oke schema emit:/i.test(blob)) return true;
  if (/schema\.decl/i.test(blob)) return true;
  if (/emit-drizzle|emitColumnSource|emitDrizzleSource|maybeEmitDomainSchema/i.test(blob)) {
    return true;
  }
  return declarePath.length > 0 && blob.includes(declarePath);
}

/**
 * True when a `src/` watcher event is a flows tree change that should
 * regenerate `generated.ts` (never the generated file itself).
 *
 * @param rel - Watcher filename (POSIX or Windows)
 */
export function isFlowsTreeWatchPath(rel: string): boolean {
  const posix = rel.replace(/\\/g, "/");
  if (!posix.includes("flows/")) return false;
  const base = posix.split("/").pop() ?? posix;
  if (base === "generated.ts" || base === "generated.ts.tmp") return false;
  return true;
}

/**
 * Frame a schema-sync failure for the `oke dev` loop: warn loud for developer
 * bugs, soft-skip only known environmental gaps. Never crashes the session.
 *
 * Matches the fail-loud status style used by compose controls (`failed —` +
 * red ●), and ADOPT_BARREL_STALE's "never silent" posture — without turning
 * this path into a hard boot failure.
 *
 * @param cwd - Project root
 * @param err - Caught value from {@link syncDevSchema} / watch push
 * @param context - Boot one-shot vs schema-watch auto-push
 */
async function formatDevSchemaSyncFailure(
  cwd: string,
  err: unknown,
  context: "boot" | "watch",
): Promise<string> {
  const msg = err instanceof Error ? err.message : String(err);
  const color = termColorEnabled();
  if (isBenignDevSchemaEnvSkip(msg)) {
    return formatStatusLine(`oke db push (dev) skipped — ${msg}`, color);
  }

  const { resolveEmitPaths } = await import("../elements/store/emit-drizzle.ts");
  const { declarePath } = resolveEmitPaths(cwd);
  if (isSchemaDeclDefinitionError(err, declarePath)) {
    return formatStatusLine(`schema.decl.ts has an error — ${msg}`, color, "error");
  }

  const label = context === "watch" ? "oke db push (schema change)" : "oke db push (dev)";
  return formatStatusLine(`${label} failed — ${msg}`, color, "error");
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
    // Inconsequential here: extract is one of two sources — fall through to on-disk JSON
    // snapshots. A broken source tree still boots Console with the last good Manifest file.
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
 * SIGKILL a pid and every child (`bun --hot` leaves a worker).
 *
 * @param pid - Root pid
 */
function killProcessTree(pid: number): void {
  const listed = Bun.spawnSync(["pgrep", "-P", String(pid)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listed.exitCode === 0) {
    for (const line of listed.stdout.toString().split("\n")) {
      const child = Number(line.trim());
      if (Number.isInteger(child) && child > 0) killProcessTree(child);
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
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
    OKE_DEV_SURFACE: "Backend",
  };

  // `--no-clear-screen`: Bun must not wipe the parent board (claim + Docker).
  // The runner reprints only the Backend ready line on soft reload.
  const proc = Bun.spawn(["bun", "--hot", "--no-clear-screen", runner], {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });

  let stopped = false;
  const stop = (): Promise<void> => {
    if (stopped) return proc.exited.then(() => {});
    stopped = true;
    try {
      // SIGKILL so `bun --hot` cannot linger and hold the project directory
      // open (create-oke afterEach `rmSync` otherwise races the child exit).
      killProcessTree(proc.pid);
    } catch {
      // Inconsequential: process already exited — kill is idempotent best-effort.
    }
    void unlink(readyPath).catch(() => {});
    return proc.exited.then(() => {});
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
 * Probe `docker info` — throws a clear error when the daemon is unavailable.
 */
async function assertDockerDaemon(): Promise<void> {
  const proc = Bun.spawn(["docker", "info"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code === 0) return;
  const detail = stderr.trim();
  throw new Error(
    "oke dev: Docker daemon unavailable — start Docker Desktop (or the Docker daemon) and retry" +
      (detail ? `\n${detail}` : ""),
  );
}

/**
 * CLI entry for `oke dev [-d [roles]]`.
 *
 * @param args - Args after `dev`
 */
export async function devCli(args: readonly string[]): Promise<number> {
  let docker: boolean | string[] | undefined;
  let noDbPush = false;
  let entry: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--docker" || a === "-d") {
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
      console.log(`oke dev [-d [roles]] [--no-db-push] [--entry|-e src/app.ts]

Watch · hot reload · Console :6533 · app :6530 · MCP :6535
Always starts Docker Compose under docker/ and runs the app on host Bun
with compose store drivers (Postgres/Redis). Regenerates client types on
every save. Auto-runs \`oke db push\` when schema.ts changes (opt out:
--no-db-push).

Optional \`-d\` / \`--docker\` filters which compose roles to start
(e.g. \`-d store.sql,store.kv\`). Requires a running Docker daemon.
Use \`oke test\` for PGLite / in-memory test posture (no Compose).
`);
      return 0;
    } else if (a === "--local" || a === "-l") {
      console.error("oke dev: --local was removed — `oke dev` always uses Docker Compose");
      console.error("Use `oke test` for PGLite test posture.");
      return 1;
    }
  }
  const { code } = await runDev({
    ...(docker === undefined ? {} : { docker }),
    ...(noDbPush ? { noDbPush: true } : {}),
    entry,
  });
  return code;
}
