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
  formatStackEnv,
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
  formatAppReadyLine,
  formatBootWarn,
  formatCliChrome,
  formatDevBanner,
  formatDevHeroDetails,
  formatDevLogSeparator,
  formatServiceLine,
  formatStackSummary,
  formatStatusLine,
  type BootProgress,
  type DevStatus,
  type StackSummaryService,
} from "../term.ts";
import { clientAdd } from "./client-add.ts";
import { resolveDriverId } from "../config/index.ts";
import { askDevMode, type AskDevModeFn } from "./ask-dev-mode.ts";
import {
  controlServicesFromStack,
  formatDevControlsHint,
  startDevControls,
  type DevComposeControlAction,
} from "./dev-controls.ts";
import {
  createDebouncedRunner,
  isDomainSchemaWatchPath,
  resolveDevAutoPush,
} from "./db-auto-push.ts";
import { resolveDrizzleConfigPath, runPush } from "./db.ts";
import { readDevMode, shouldAskDevMode, writeDevMode, type DevMode } from "./dev-mode.ts";
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
  const previousWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (/^oke boot:/i.test(msg.trim())) {
      write(formatBootWarn(msg.trim()));
      return;
    }
    previousWarn.apply(console, args as Parameters<typeof console.warn>);
  };
  const restoreWarn = () => {
    console.warn = previousWarn;
  };
  const cwd = options.cwd ?? process.cwd();
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

  const explicitLocal = options.local === true;
  const explicitDocker = options.docker === true || Array.isArray(options.docker);
  if (explicitLocal && explicitDocker) {
    console.error("oke dev: use either --local or --docker, not both");
    restoreWarn();
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
      restoreWarn();
      return { code: 1 };
    }
    mode = chosen;
    await writeDevMode(cwd, mode);
  } else {
    // Non-TTY + unset: deterministic local — zero ask, zero docker, no save.
    mode = "local";
  }

  // Paint chrome immediately so docker/vault work is never a blank 6s wait.
  let okeVersion = "0.0.0";
  try {
    const pkg = (await Bun.file(resolve(import.meta.dir, "../../package.json")).json()) as {
      version?: string;
    };
    if (typeof pkg.version === "string") okeVersion = pkg.version;
  } catch {
    // shipped binary may not sit next to package.json
  }
  const earlyProfile = resolveDevProfile({ docker: mode === "docker", nodeEnv: "development" });
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
    readonly kind: "openai-compatible" | "ollama";
  } | null = null;
  /** Hero AI status dot (yellow while model loads). */
  let heroAiStatus: DevStatus | undefined;
  let loadedConfig: Awaited<ReturnType<typeof loadOkeConfig>>["config"] | null = null;
  try {
    loadedConfig = (await loadOkeConfig(cwd)).config;
  } catch {
    loadedConfig = null;
  }

  // Local mode + a configured `meilisearch` store.index: bring the server up
  // as a fourth local process (binary on PATH — a documented prerequisite,
  // like Docker for --docker). Docker mode instead relies on the recipe.
  let meili: import("./meilisearch-local.ts").LocalMeilisearchHandle | null = null;
  if (mode === "local") {
    const indexId = resolveDriverId(loadedConfig?.drivers?.store?.index, "local") ?? "memory";
    if (indexId === "meilisearch") {
      try {
        const { startLocalMeilisearch } = await import("./meilisearch-local.ts");
        meili = await startLocalMeilisearch({ cwd });
        write(formatStatusLine(`meilisearch local server on ${meili.url}`));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        restoreWarn();
        return { code: 1 };
      }
    }
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
          restoreWarn();
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
            const args = ["compose", ...files.flatMap((f) => ["-f", f]), "up", "-d"];
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
                `oke dev --docker: docker compose exited ${code}` + (detail ? `\n${detail}` : ""),
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
        };

        // Real OpenBao vault: init once / unseal every start, then expose the
        // least-privilege app token to the app + Console (never root).
        const vaultSpec = derived.specs.find((s) => s.role === "vault");
        if (vaultSpec) {
          bootProgress.set("vault", formatStatusLine("vault unseal…", undefined, "pending"));
          const { ensureOpenBao, openbaoStackEnv } = await import("./openbao-bootstrap.ts");
          const vaultNames = await tryLoadVaultSecretNames(cwd);
          const boot = await ensureOpenBao({
            cwd,
            url: `http://127.0.0.1:${vaultSpec.hostPort}`,
            names: vaultNames,
          });
          Object.assign(stackEnv!, openbaoStackEnv(boot));
          Object.assign(dockerStarted.env, openbaoStackEnv(boot));
          // Rewrite .env.docker with the full stack env (including token) so a
          // later ensureDockerStack / writeDerivedFiles does not drop it.
          const envPath = resolve(dockerOut, ".env.docker");
          await Bun.write(envPath, formatStackEnv(stackEnv!));
          bootProgress.set("vault", formatStatusLine("vault ready", undefined, "ready"));
        }

        // Stream compose health until infra is up (AI may stay pending — model load).
        const aiServiceName = derived.specs.find((s) => s.role === "ai")?.serviceName;
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

        // AI model: Ollama pulls via HTTP (blocking with progress). OpenAI-compatible
        // servers (llama.cpp / vLLM / SGLang) load in-container — poll readiness in
        // the background. Never treat compose "healthy" as model-ready.
        const aiSpec = derived.specs.find((s) => s.role === "ai");
        if (aiSpec) {
          const { recipeFor } = await import("../docker/recipes/index.ts");
          const recipeId = recipeFor(aiSpec.image).id;
          const model =
            stackEnv!.OKE_AI_MODEL?.trim() ||
            process.env.OKE_AI_MODEL?.trim() ||
            (recipeId === "ollama" ? "qwen3.5:9b" : "smollm2");
          const url = `http://127.0.0.1:${aiSpec.hostPort}`;
          const paintAi = (status: DevStatus, detail?: string) => {
            heroAiStatus = status;
            if (!pendingStackSummary) return;
            pendingStackSummary = {
              ...pendingStackSummary,
              services: pendingStackSummary.services.map((svc) =>
                svc.serviceName === aiSpec.serviceName
                  ? {
                      ...svc,
                      status,
                      detail: detail ?? svc.detail,
                    }
                  : svc,
              ),
            };
          };
          if (recipeId === "ollama") {
            bootProgress.set(
              "ai-model",
              formatStatusLine(`AI ${model} — ensuring…`, undefined, "pending"),
            );
            const { ensureOllamaModel } = await import("../docker/ollama-pull.ts");
            await ensureOllamaModel({
              url,
              model,
              onStatus: (line) =>
                bootProgress.set("ai-model", formatStatusLine(line, undefined, "pending")),
            });
            pendingAiModelWatch = { url, model, kind: "ollama" };
            paintAi("ready", model);
          } else if (recipeId === "llama-cpp" || recipeId === "vllm" || recipeId === "sglang") {
            pendingAiModelWatch = {
              url: `${url}/v1`,
              model,
              kind: "openai-compatible",
            };
            bootProgress.set(
              "ai-model",
              formatStatusLine(`AI ${model} — probing…`, undefined, "pending"),
            );
            const { probeAiModelStatus, formatAiModelStatusMessage } =
              await import("../docker/ai-model-status.ts");
            const snap = await probeAiModelStatus({
              url: `${url}/v1`,
              model,
              kind: "openai-compatible",
            });
            const status = devStatusFromAiPhase(snap.phase);
            paintAi(status, snap.phase === "ready" ? model : `${model} · ${snap.phase}`);
            bootProgress.set(
              "ai-model",
              formatStatusLine(formatAiModelStatusMessage(snap), undefined, status),
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        console.error("oke dev: docker mode failed — fix compose, or run `oke mode local`");
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
  // OpenAI-compatible model load can outlive compose health — default AI ● to pending.
  if (pendingAiModelWatch && heroAiStatus === undefined) {
    heroAiStatus = "pending";
  }
  const heroSnapshot = buildDevHeroSnapshot({
    config: loadedConfig,
    docker: mode === "docker",
    sqlDriver: mode === "docker" ? stackSqlDriver : undefined,
    kvDriver: mode === "docker" ? stackKvDriver : undefined,
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
        const container = one("ai");
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
              ? liveComposeHealth.get("ai") === "error"
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
            if (svc.serviceName === "ai") {
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
    // Breath between elements and Docker — they read as two panes, not one block.
    const gap = elementsBlock && stackBlock ? "\n" : "";
    return `${elementsBlock}${gap}${stackBlock}`;
  };

  // Drop ephemeral progress — final elements + Docker board replaces it.
  bootProgress.clear();
  const bootBoard = createAnchoredBoard(write);
  bootBoard.paint(paintBootBoard(heroAiStatus));
  // Track everything printed below so ● can rewrite in place for the session.
  write = bootBoard.wrapWrite(write);

  if (options.dryRun) {
    bootBoard.stop();
    restoreWarn();
    return { code: 0, plan };
  }

  const repaintBoard = (aiStatus?: DevStatus): void => {
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
        if (liveComposeHealth.get("ai") === "error") {
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

  // Live ● for the whole session — catch Docker Desktop stops / crashes.
  // Updates the board only (no redis stopped / starting / ready log spam).
  if (dockerStarted && composeFiles) {
    const { startComposeHealthWatch } = await import("../docker/compose-health.ts");
    const started = dockerStarted;
    stopComposeHealthWatch = startComposeHealthWatch({
      files: started.files,
      cwd: started.cwd,
      env: started.env,
      intervalMs: 2_000,
      onChange: (map) => {
        liveComposeHealth = map;
        if (map.get("ai") === "error") heroAiStatus = "error";
        repaintBoard();
      },
    });
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

  // One-shot schema sync for the session profile (both local and docker):
  // emits schema.generated.ts for the active dialect, then pushes via
  // drizzle-kit. Data planes stay isolated — session flags never rewrite
  // `.oke/mode`. Watch auto-push below remains local-only.
  if (!options.noDbPush) {
    const { syncDevSchema } = await import("./dev-schema-sync.ts");
    try {
      const result = await syncDevSchema(cwd, mode, {
        write: chromeWrite,
        quietComposeReady: mode === "docker",
      });
      write(
        formatStatusLine(
          `oke db push (${mode} · ${result.dialect}) ${result.code === 0 ? "ok" : "failed"}`,
        ),
      );
      if (result.code === 0) {
        const { maybeAskSeed } = await import("./ask-seed.ts");
        await maybeAskSeed({
          cwd,
          env: mode,
          write,
          stdinIsTTY: options.stdinIsTTY ?? process.stdin.isTTY,
        });
      }
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
    ...(meili?.overlay ?? {}),
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
  if (dockerStarted && (options.stdinIsTTY ?? process.stdin.isTTY)) {
    write(formatDevControlsHint());
  }

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
    meili?.stop();
    app.stop();
    consoleServer.stop();
    mcpServer?.stop();
    docsMcpServer?.stop();
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

  if (options.onReady) await options.onReady(session);

  // Keyboard controls (docker + TTY): start/stop/restart services without leaving oke dev.
  if (keepAlive && dockerStarted && (options.stdinIsTTY ?? process.stdin.isTTY)) {
    const started = dockerStarted;
    const syncComposeBoard = async (): Promise<void> => {
      const { readComposeHealth } = await import("../docker/compose-health.ts");
      liveComposeHealth = await readComposeHealth({
        files: started.files,
        cwd: started.cwd,
        env: started.env,
      });
      if (liveComposeHealth.get("ai") === "error") heroAiStatus = "error";
      repaintBoard();
    };
    const refreshChrome = async (): Promise<void> => {
      await syncComposeBoard();
      // Clear log noise; reprint head + latest ● board + surfaces + empty Logs.
      write(clearTerminalScreen());
      bootBoard.reset();
      write(
        formatDevBanner({
          profile: earlyProfile,
          runtimeEnv: resolveDevRuntimeEnv(earlyProfile),
          system: formatHeroSystemLine(),
          version: okeVersion,
        }),
      );
      bootBoard.paint(paintBootBoard(heroAiStatus));
      write(formatAppReadyLine(`http://127.0.0.1:${boundAppPort}`));
      write(formatServiceLine("Console", `http://127.0.0.1:${boundConsolePort}`));
      if (mcpServer) {
        write(formatServiceLine("MCP", `http://127.0.0.1:${boundMcpPort}`));
      }
      if (docsMcpServer) {
        write(formatServiceLine("Docs MCP", `http://127.0.0.1:${boundDocsMcpPort}`));
      }
      write(formatDevLogSeparator());
      write(formatDevControlsHint());
    };
    const controls = startDevControls({
      write,
      isTTY: options.stdinIsTTY ?? process.stdin.isTTY,
      onQuit: () => {
        stop();
        process.exit(0);
      },
      onRefresh: () => refreshChrome(),
      // Refresh first so help/services never sit in the middle of request logs.
      onShowPanel: async (body) => {
        await refreshChrome();
        write(body);
      },
      onComposeSettled: () => syncComposeBoard(),
      services: () => controlServicesFromStack(pendingStackSummary?.services ?? []),
      statusOf: (serviceName) => liveComposeHealth.get(serviceName),
      composeAction: async (action: DevComposeControlAction, serviceNames) => {
        const files = started.files;
        const finalArgs =
          action === "up" && serviceNames.length === 0
            ? ["compose", ...files.flatMap((f) => ["-f", f]), "up", "-d"]
            : action === "up"
              ? [
                  "compose",
                  ...files.flatMap((f) => ["-f", f]),
                  "up",
                  "-d",
                  "--no-deps",
                  ...serviceNames,
                ]
              : ["compose", ...files.flatMap((f) => ["-f", f]), action, ...serviceNames];
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
          throw new Error(
            `docker compose ${action} exited ${code}` + (detail ? `\n${detail}` : ""),
          );
        }
      },
    });
    stopDevControls = () => controls.stop();
  }

  if (!keepAlive) {
    return { code: 0, plan: session.plan, session };
  }

  // Keep the process alive.
  await new Promise(() => {});
  return { code: 0, plan: session.plan, session };
}

/**
 * Declared vault secret names from the project Manifest (policy scope).
 *
 * @param cwd - Project root
 */
async function tryLoadVaultSecretNames(cwd: string): Promise<readonly string[]> {
  try {
    const { extractManifest } = await import("../compiler/extract.ts");
    const manifest = await extractManifest({ rootDir: cwd });
    return Object.keys(manifest.vault ?? {});
  } catch {
    return [];
  }
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
    OKE_DEV_SURFACE: "Backend",
  };

  // `--no-clear-screen`: Bun must not wipe the hero; the runner clears only
  // request logs on soft reload and reprints Backend / Console / MCP URLs.
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
