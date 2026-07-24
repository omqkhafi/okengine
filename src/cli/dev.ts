/**
 * `oke dev` — watch · hot reload · Console :6533 · client types on save.
 * `oke dev --stack` also boots generated compose.
 */

import { watch } from "node:fs";
import { resolve } from "node:path";
import {
  deriveInfrastructure,
  formatStackEnv,
  writeDerivedFiles,
  type DeriveOptions,
} from "../docker/index.ts";
import { APP_PORT, CONSOLE_PORT, MCP_PORT } from "../runtime/types.ts";
import { clientAdd } from "./client-add.ts";
import { loadOkeConfig, resolveImages } from "./load-config.ts";

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
  /** Serve Console stub (injectable). */
  readonly serveConsole?: (port: number) => Promise<{ stop(): void }>;
  /** Start app under bun --hot (injectable). */
  readonly startApp?: (entry: string, env: Record<string, string>) => Promise<{
    stop(): void;
  }>;
}

/** Result of a dry-run / prepared dev session. */
export interface DevPlan {
  readonly entry: string;
  readonly appPort: number;
  readonly consolePort: number;
  readonly mcpPort: number;
  readonly stackRoles: readonly string[] | null;
  readonly composeFiles: readonly string[] | null;
  readonly stackEnv: Readonly<Record<string, string>> | null;
}

/**
 * Prepare (and optionally run) a dev session.
 *
 * @param options - Flags
 */
export async function runDev(
  options: DevOptions = {},
): Promise<{ readonly code: number; readonly plan?: DevPlan }> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const appPort = Number(Bun.env.PORT ?? APP_PORT);
  const consolePort = CONSOLE_PORT;
  const mcpPort = MCP_PORT;

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

  const serveConsole =
    options.serveConsole ??
    (async (port) => {
      const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch() {
          return new Response(
            `<!doctype html><title>oke Console</title><h1>oke Console</h1><p>Derived panels load here.</p>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        },
      });
      return {
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

  const appUrl = `http://127.0.0.1:${appPort}`;
  await regen(appUrl);

  const watcher = watch(
    resolve(cwd, "src"),
    { recursive: true },
    () => {
      void regen(appUrl);
    },
  );

  const stop = () => {
    watcher.close();
    app.stop();
    consoleServer.stop();
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  // Keep the process alive.
  await new Promise(() => {});
  return { code: 0, plan };
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
