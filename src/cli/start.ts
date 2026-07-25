/**
 * `oke start` — runs exactly what production runs (Docker CMD).
 */

import { resolve } from "node:path";
import { APP_PORT } from "../runtime/types.ts";

/** Options for {@link runStart}. */
export interface StartOptions {
  readonly cwd?: string;
  readonly entry?: string;
  readonly port?: number;
  readonly write?: (text: string) => void;
  /**
   * Spawn/import hook (tests). Defaults to dynamic-importing the entry.
   *
   * @param entry - Absolute entry path
   * @param env - Process env overlay
   */
  readonly runEntry?: (
    entry: string,
    env: Record<string, string>,
  ) => Promise<void>;
}

/**
 * Resolve the production entry module.
 *
 * @param cwd - Project root
 * @param explicit - Optional `--entry`
 */
export async function resolveStartEntry(
  cwd: string,
  explicit?: string,
): Promise<string> {
  if (explicit) return resolve(cwd, explicit);
  const pkgPath = resolve(cwd, "package.json");
  if (await Bun.file(pkgPath).exists()) {
    const pkg = (await Bun.file(pkgPath).json()) as {
      main?: string;
      okengine?: { entry?: string };
    };
    if (pkg.okengine?.entry) return resolve(cwd, pkg.okengine.entry);
    if (pkg.main) return resolve(cwd, pkg.main);
  }
  for (const candidate of ["src/app.ts", "src/index.ts", "index.ts", "app.ts"]) {
    const path = resolve(cwd, candidate);
    if (await Bun.file(path).exists()) return path;
  }
  throw new Error(
    "oke start: no entry found — set package.json okengine.entry or pass --entry",
  );
}

/**
 * Run the production entry (Docker CMD).
 *
 * @param options - Entry / port
 */
export async function runStart(options: StartOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  try {
    const entry = await resolveStartEntry(cwd, options.entry);
    const port = String(options.port ?? Number(Bun.env.PORT ?? APP_PORT));
    const env = { ...process.env, NODE_ENV: "production", PORT: port } as Record<
      string,
      string
    >;
    write(`oke start: ${entry} (port ${port})\n`);
    if (options.runEntry) {
      await options.runEntry(entry, env);
      return 0;
    }
    // Production: import the entry; apps call createBunRuntime().serve themselves.
    Object.assign(process.env, env);
    await import(entry);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * CLI entry for `oke start`.
 *
 * @param args - Args after `start`
 */
export async function startCli(args: readonly string[]): Promise<number> {
  let entry: string | undefined;
  let port: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--entry" || a === "-e") entry = args[++i];
    else if (a === "--port" || a === "-p") port = Number(args[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`oke start [--entry|-e src/app.ts] [--port|-p 6530]

Run exactly what production runs. This is the Docker CMD.
`);
      return 0;
    }
  }
  return runStart({ entry, port });
}
