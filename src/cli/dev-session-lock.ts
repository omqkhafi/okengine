/**
 * `.oke/dev.json` — session lock for owned `oke dev` / TUI sessions.
 *
 * Distinguishes managed (our pid) vs external (ports live, not our lock)
 * so stop/restart never kills a foreign process.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isPortInUse } from "./ports.ts";

/** Relative path under the project root. */
export const DEV_SESSION_LOCK_REL = ".oke/dev.json";

/** Bound ports recorded in the session lock. */
export type DevSessionPorts = {
  readonly app: number;
  readonly console: number;
  readonly mcp: number;
  readonly docsMcp: number;
};

/** On-disk lock written when this process owns the dev session. */
export type DevSessionLock = {
  readonly pid: number;
  readonly ports: DevSessionPorts;
  readonly startedAt: string;
  readonly cwd: string;
};

/** How the TUI / controller sees the live stack. */
export type DevOwnership = "managed" | "external" | "stopped";

/**
 * Absolute path to the lock file for a project root.
 *
 * @param cwd - Project root
 */
export function devSessionLockPath(cwd: string): string {
  return resolve(cwd, DEV_SESSION_LOCK_REL);
}

/**
 * True when `pid` looks alive on this host (signal 0).
 *
 * @param pid - Process id
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse and validate a lock object from JSON.
 *
 * @param raw - Unknown JSON value
 */
export function parseDevSessionLock(raw: unknown): DevSessionLock | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["pid"] !== "number" || !Number.isFinite(o["pid"])) return null;
  if (typeof o["startedAt"] !== "string" || typeof o["cwd"] !== "string") return null;
  const ports = o["ports"];
  if (ports === null || typeof ports !== "object") return null;
  const p = ports as Record<string, unknown>;
  for (const key of ["app", "console", "mcp", "docsMcp"] as const) {
    if (typeof p[key] !== "number" || !Number.isFinite(p[key])) return null;
  }
  return {
    pid: o["pid"],
    startedAt: o["startedAt"],
    cwd: o["cwd"],
    ports: {
      app: p["app"] as number,
      console: p["console"] as number,
      mcp: p["mcp"] as number,
      docsMcp: p["docsMcp"] as number,
    },
  };
}

/**
 * Read the session lock if present and well-formed.
 *
 * @param cwd - Project root
 */
export async function readDevSessionLock(cwd: string): Promise<DevSessionLock | null> {
  const path = devSessionLockPath(cwd);
  if (!(await Bun.file(path).exists())) return null;
  try {
    const raw: unknown = await Bun.file(path).json();
    return parseDevSessionLock(raw);
  } catch {
    return null;
  }
}

/**
 * Write the session lock (creates `.oke/` as needed).
 *
 * @param cwd - Project root
 * @param lock - Lock payload
 */
export async function writeDevSessionLock(cwd: string, lock: DevSessionLock): Promise<void> {
  const path = devSessionLockPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(lock, null, 2)}\n`);
}

/**
 * Remove the lock file if present (best-effort).
 *
 * @param cwd - Project root
 */
export async function clearDevSessionLock(cwd: string): Promise<void> {
  const path = devSessionLockPath(cwd);
  try {
    await Bun.file(path)
      .exists()
      .then(async (ok) => {
        if (ok) await unlinkQuiet(path);
      });
  } catch {
    // ignore
  }
}

/**
 * @param path - Absolute path
 */
async function unlinkQuiet(path: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(path);
  } catch {
    // already gone
  }
}

/**
 * Probe whether preferred ports are in use.
 *
 * @param ports - Ports to check
 * @param probe - Injectable busy check
 */
export async function probeDevPortsBusy(
  ports: DevSessionPorts,
  probe: (port: number) => Promise<boolean> = isPortInUse,
): Promise<{
  readonly app: boolean;
  readonly console: boolean;
  readonly mcp: boolean;
  readonly docsMcp: boolean;
  readonly any: boolean;
}> {
  const app = ports.app !== 0 && (await probe(ports.app));
  const consolePort = ports.console !== 0 && (await probe(ports.console));
  const mcp = ports.mcp !== 0 && (await probe(ports.mcp));
  const docsMcp = ports.docsMcp !== 0 && (await probe(ports.docsMcp));
  return {
    app,
    console: consolePort,
    mcp,
    docsMcp,
    any: app || consolePort || mcp || docsMcp,
  };
}

/**
 * Resolve ownership for a project: managed / external / stopped.
 *
 * @param cwd - Project root
 * @param preferredPorts - Ports to probe when lock is missing/stale
 * @param probe - Injectable busy check
 */
export async function resolveDevOwnership(
  cwd: string,
  preferredPorts: DevSessionPorts,
  probe: (port: number) => Promise<boolean> = isPortInUse,
): Promise<{
  readonly ownership: DevOwnership;
  readonly lock: DevSessionLock | null;
  readonly busy: Awaited<ReturnType<typeof probeDevPortsBusy>>;
}> {
  const root = resolve(cwd);
  const lock = await readDevSessionLock(root);
  const ports = lock?.ports ?? preferredPorts;
  const busy = await probeDevPortsBusy(ports, probe);

  if (lock && isPidAlive(lock.pid) && resolve(lock.cwd) === root) {
    return { ownership: "managed", lock, busy };
  }

  // Stale lock (dead pid) — ignore for ownership; treat as free or external by ports.
  if (lock && !isPidAlive(lock.pid)) {
    await clearDevSessionLock(root);
  }

  if (busy.app || busy.console) {
    return { ownership: "external", lock: null, busy };
  }

  return { ownership: "stopped", lock: null, busy };
}
