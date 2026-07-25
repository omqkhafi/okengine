/**
 * `oke dev` — watch · hot reload · Console :6533 · MCP :6535 · client types on save.
 * `oke dev --stack` also boots generated compose.
 */

import { watch } from "node:fs";
import { resolve } from "node:path";
import type { SessionStore } from "../auth/sessions.ts";
import type { ConsoleAppHandle } from "../console/server/app.ts";
import type { ConsoleState } from "../console/server/state.ts";
import {
  deriveInfrastructure,
  formatStackEnv,
  writeDerivedFiles,
  type DeriveOptions,
} from "../docker/index.ts";
import type { Manifest } from "../manifest/types.ts";
import type { McpContext } from "../mcp/tools.ts";
import { APP_PORT, CONSOLE_PORT, MCP_PORT } from "../runtime/types.ts";
import { clientAdd } from "./client-add.ts";
import { loadManifest, loadOkeConfig, resolveImages } from "./load-config.ts";
import { mcpContextFromConsole } from "./mcp-from-console.ts";

/** Stoppable surface handle. */
export interface DevSurfaceHandle {
  readonly stop: () => void;
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

/** Options for {@link runDev}. */
export interface DevOptions {
  readonly cwd?: string;
  readonly entry?: string;
  readonly stack?: boolean | readonly string[];
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
   * Boot compose stack (injectable).
   *
   * @param composeFiles - `-f` list excluding override if missing
   * @param cwd - Project root
   */
  readonly composeUp?: (
    composeFiles: readonly string[],
    cwd: string,
  ) => Promise<void>;
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
  /** Start app under bun --hot (injectable). */
  readonly startApp?: (entry: string, env: Record<string, string>) => Promise<{
    stop(): void;
  }>;
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
  const appPort = options.appPort ?? Number(Bun.env.PORT ?? APP_PORT);
  const consolePort = options.consolePort ?? CONSOLE_PORT;
  const mcpPort = options.mcpPort ?? MCP_PORT;
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

  let stackRoles: string[] | null = null;
  let composeFiles: string[] | null = null;
  let stackEnv: Record<string, string> | null = null;

  if (options.stack) {
    let images = options.images;
    if (!images) {
      try {
        const loaded = await loadOkeConfig(cwd);
        images = resolveImages(loaded.config);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return { code: 1 };
      }
    }
    if (Array.isArray(options.stack)) {
      const allow = new Set(options.stack);
      images = Object.fromEntries(
        Object.entries(images).filter(([role]) => allow.has(role)),
      );
      stackRoles = [...allow];
    } else {
      stackRoles = Object.keys(images);
    }

    const derived = deriveInfrastructure({
      images,
      app: "dev",
      prod: false,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      host: "127.0.0.1",
    });
    // Layer 4 is user-owned — include only if the file already exists.
    const existingOverride = await Bun.file(
      resolve(cwd, "compose.override.yml"),
    ).exists();
    composeFiles = derived.composeFiles.filter(
      (f) => f !== "compose.override.yml" || existingOverride,
    );
    stackEnv = { ...derived.stackEnv };

    if (!options.dryRun) {
      await writeDerivedFiles(derived, cwd, { writeStackEnv: true });
      // Ensure .env.stack is loaded for the app process
      await Bun.write(resolve(cwd, ".env.stack"), formatStackEnv(stackEnv));
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
            throw new Error(`oke dev --stack: docker compose exited ${code}`);
          }
        });
      await up(composeFiles, cwd);
      write(`oke dev: stack up (${stackRoles.join(", ")})\n`);
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

  write(
    `oke dev: app :${appPort} · Console :${consolePort} · MCP :${mcpPort}\n`,
  );
  write("oke dev: watching — client types regenerate on save\n");

  if (options.dryRun) return { code: 0, plan };

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: "development",
    PORT: String(appPort),
    ...(stackEnv ?? {}),
  };

  const startApp =
    options.startApp ??
    (async (entryPath, appEnv) => {
      const proc = Bun.spawn(
        ["bun", "--hot", entryPath],
        { cwd, env: appEnv, stdout: "inherit", stderr: "inherit" },
      );
      return {
        stop() {
          proc.kill();
        },
      };
    });

  const seedManifest =
    options.manifest !== undefined
      ? options.manifest
      : await tryLoadProjectManifest(cwd);

  const serveConsole =
    options.serveConsole ??
    (async (port) => {
      const { serveConsole: serveConsoleKernel } = await import(
        "../console/server/serve.ts"
      );
      const server = await serveConsoleKernel({
        port,
        hostname: "127.0.0.1",
        cwd,
        env: "dev",
        silentClaim: options.silentClaim ?? false,
        ...(options.secret !== undefined ? { secret: options.secret } : {}),
        ...(seedManifest !== undefined && seedManifest !== null
          ? { manifest: seedManifest }
          : {}),
      });
      write(`oke Console http://127.0.0.1:${server.port}\n`);
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
      write(`oke MCP http://127.0.0.1:${server.port}\n`);
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
        write("oke dev: regenerated oke-client.d.ts\n");
      } catch {
        // App may not be ready yet — ignore until next save.
      }
    });

  const app = await startApp(plan.entry, env);
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

  const appUrl = `http://127.0.0.1:${appPort}`;
  await regen(appUrl);

  const watcher = watch(
    resolve(cwd, "src"),
    { recursive: true },
    () => {
      void regen(appUrl);
    },
  );

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
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
      consolePort: boundConsolePort,
      mcpPort: boundMcpPort,
    },
    stop,
    appPort,
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
 * Load `oke.manifest.json` / `manifest.oke.json` when present.
 *
 * @param cwd - Project root
 */
async function tryLoadProjectManifest(
  cwd: string,
): Promise<Manifest | null | undefined> {
  for (const name of ["oke.manifest.json", "manifest.oke.json"]) {
    const path = resolve(cwd, name);
    if (await Bun.file(path).exists()) {
      return loadManifest(path);
    }
  }
  return undefined;
}

/**
 * CLI entry for `oke dev [--stack|-s [roles]]`.
 *
 * @param args - Args after `dev`
 */
export async function devCli(args: readonly string[]): Promise<number> {
  let stack: boolean | string[] | undefined;
  let entry: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--stack" || a === "-s") {
      const next = args[i + 1];
      if (next && !next.startsWith("-") && /^[\w.,]+$/.test(next)) {
        stack = next.split(",").map((s) => s.trim()).filter(Boolean);
        i++;
      } else {
        stack = true;
      }
    } else if (a === "--entry") entry = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke dev [--stack|-s [roles]] [--entry src/app.ts]

Watch · hot reload · Console :6533 · app :6530 · MCP :6535
Regenerates client types on every save.
--stack boots generated compose (partial roles: -s store.sql,signal).
`);
      return 0;
    }
  }
  const { code } = await runDev({
    stack: stack === undefined ? undefined : stack,
    entry,
  });
  return code;
}
