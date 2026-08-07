/**
 * Read `docker compose ps` health for `oke dev` status dots.
 */

import type { DevStatus } from "../term.ts";

/** One service row from `docker compose ps --format json`. */
export type ComposePsRow = {
  readonly Service?: string;
  readonly State?: string;
  readonly Health?: string;
  readonly Status?: string;
};

/**
 * Map a compose ps row to a {@link DevStatus}.
 *
 * @param row - Parsed ps line
 */
export function composeRowToStatus(row: ComposePsRow): DevStatus {
  const health = (row.Health ?? "").trim().toLowerCase();
  const state = (row.State ?? "").trim().toLowerCase();
  if (health === "healthy") return "ready";
  if (health === "unhealthy") return "error";
  if (health === "starting") return "pending";
  if (state === "running" || state === "up") return "ready";
  if (
    state === "exited" ||
    state === "dead" ||
    state === "stopped" ||
    state === "restarting" ||
    state === "removing" ||
    state === "oomkilled"
  ) {
    return "error";
  }
  // Status text for stopped containers (`Exited (0) 2 seconds ago`).
  const statusText = (row.Status ?? "").toLowerCase();
  if (statusText.startsWith("exited") || statusText.startsWith("dead")) return "error";
  if (state === "created" || state === "paused" || state.length === 0) return "pending";
  // Status text like "Up 3 seconds (healthy)"
  if (statusText.includes("(healthy)")) return "ready";
  if (statusText.includes("(unhealthy)")) return "error";
  if (statusText.includes("(health: starting)") || statusText.includes("(starting)")) {
    return "pending";
  }
  if (statusText.startsWith("up")) return "ready";
  return "pending";
}

/**
 * Parse NDJSON or a JSON array from `docker compose ps --format json`.
 *
 * @param text - stdout
 */
export function parseComposePsJson(text: string): readonly ComposePsRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      return Array.isArray(arr) ? (arr as ComposePsRow[]) : [];
    } catch {
      return [];
    }
  }
  const rows: ComposePsRow[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t) as ComposePsRow);
    } catch {
      // skip garbage lines
    }
  }
  return rows;
}

/**
 * Build service-name → status from compose ps output.
 *
 * @param text - stdout from `docker compose ps --format json`
 */
export function composeHealthByService(text: string): Map<string, DevStatus> {
  const map = new Map<string, DevStatus>();
  for (const row of parseComposePsJson(text)) {
    const name = row.Service?.trim();
    if (!name) continue;
    map.set(name, composeRowToStatus(row));
  }
  return map;
}

/** Options for {@link readComposeHealth}. */
export type ReadComposeHealthOptions = {
  readonly files: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  /** Injectable runner (tests). */
  readonly run?: (
    args: readonly string[],
    cwd: string,
    env: Record<string, string>,
  ) => Promise<string>;
};

/**
 * Query `docker compose ps` and return health by Compose service name.
 *
 * @param opts - Compose files + cwd
 */
export async function readComposeHealth(
  opts: ReadComposeHealthOptions,
): Promise<Map<string, DevStatus>> {
  const run =
    opts.run ??
    (async (args, cwd, env) => {
      const proc = Bun.spawn(["docker", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...env },
      });
      const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      if (code !== 0) return "";
      return stdout;
    });
  // `-a` includes stopped/exited — default `ps` hides them and ● would stay green.
  const args = ["compose", ...opts.files.flatMap((f) => ["-f", f]), "ps", "-a", "--format", "json"];
  const text = await run(args, opts.cwd, opts.env);
  return composeHealthByService(text);
}

/** Options for {@link watchComposeHealth}. */
export type WatchComposeHealthOptions = ReadComposeHealthOptions & {
  /** Fired when a service status changes. */
  readonly onUpdate?: (service: string, status: DevStatus) => void;
  /** Stop early when this returns true. Default: every service ready or error. */
  readonly isDone?: (map: Map<string, DevStatus>) => boolean;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
};

/**
 * Poll compose health until ready/error/timeout, emitting per-service changes.
 *
 * @param opts - Compose target + callbacks
 */
export async function watchComposeHealth(
  opts: WatchComposeHealthOptions,
): Promise<Map<string, DevStatus>> {
  const intervalMs = opts.intervalMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const now = opts.now ?? Date.now;
  const started = now();
  const prev = new Map<string, DevStatus>();
  let latest = new Map<string, DevStatus>();
  const done =
    opts.isDone ??
    ((map) => map.size > 0 && [...map.values()].every((s) => s === "ready" || s === "error"));

  for (;;) {
    latest = await readComposeHealth(opts);
    for (const [name, status] of latest) {
      if (prev.get(name) !== status) {
        prev.set(name, status);
        opts.onUpdate?.(name, status);
      }
    }
    if (done(latest)) return latest;
    if (now() - started >= timeoutMs) return latest;
    await sleep(intervalMs);
  }
}

/** Options for {@link startComposeHealthWatch}. */
export type StartComposeHealthWatchOptions = ReadComposeHealthOptions & {
  /** Fired on every poll with the full map (and when any service changed). */
  readonly onChange: (
    map: Map<string, DevStatus>,
    changed: readonly { readonly service: string; readonly status: DevStatus }[],
  ) => void;
  readonly intervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};

/**
 * Poll compose health for the life of an `oke dev` session.
 *
 * @param opts - Compose target + change callback
 * @returns Stop function
 */
export function startComposeHealthWatch(opts: StartComposeHealthWatchOptions): () => void {
  const intervalMs = opts.intervalMs ?? 2_000;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  let stopped = false;
  const prev = new Map<string, DevStatus>();

  const tick = async (): Promise<void> => {
    while (!stopped) {
      const latest = await readComposeHealth(opts);
      if (stopped) return;
      const changed: { service: string; status: DevStatus }[] = [];
      for (const [name, status] of latest) {
        if (prev.get(name) !== status) {
          prev.set(name, status);
          changed.push({ service: name, status });
        }
      }
      // Services that vanished from ps -a (removed) → treat as error once.
      for (const name of [...prev.keys()]) {
        if (!latest.has(name)) {
          prev.delete(name);
          changed.push({ service: name, status: "error" });
          latest.set(name, "error");
        }
      }
      if (changed.length > 0 || prev.size === 0) {
        for (const [name, status] of latest) prev.set(name, status);
        opts.onChange(latest, changed);
      }
      await sleep(intervalMs);
    }
  };

  void tick();
  return () => {
    stopped = true;
  };
}
