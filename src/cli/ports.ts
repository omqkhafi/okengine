/**
 * Dev-time port probing — Next.js-style prefer-then-increment.
 */

import { createServer } from "node:net";

/** Max upward probes from a preferred port before failing. */
const MAX_PORT_ATTEMPTS = 100;

/**
 * True when something is already listening on `port` at 127.0.0.1.
 *
 * @param port - TCP port
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolvePromise(err.code === "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolvePromise(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find the first free port at or above `preferred`, skipping occupied set.
 *
 * @param preferred - Starting port (e.g. 6530)
 * @param occupied - Ports already claimed in this session
 * @param probe - Injectable busy check (tests)
 */
export async function findFreePort(
  preferred: number,
  occupied: ReadonlySet<number> = new Set(),
  probe: (port: number) => Promise<boolean> = isPortInUse,
): Promise<number> {
  if (!Number.isFinite(preferred) || preferred < 0) {
    throw new Error(`oke: invalid preferred port ${preferred}`);
  }
  // Ephemeral (0) — leave to the OS; no probing.
  if (preferred === 0) return 0;

  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = preferred + i;
    if (occupied.has(port)) continue;
    if (!(await probe(port))) return port;
  }
  throw new Error(`oke: no free port near ${preferred} after ${MAX_PORT_ATTEMPTS} attempts`);
}

/**
 * Resolve distinct free ports for app · Console · MCP (dev only).
 *
 * @param preferred - Preferred ports
 * @param probe - Injectable busy check (tests)
 */
export async function resolveDevPorts(
  preferred: {
    readonly app: number;
    readonly console: number;
    readonly mcp: number;
  },
  probe: (port: number) => Promise<boolean> = isPortInUse,
): Promise<{
  readonly app: number;
  readonly console: number;
  readonly mcp: number;
}> {
  const occupied = new Set<number>();
  const app = await findFreePort(preferred.app, occupied, probe);
  if (app !== 0) occupied.add(app);
  const consolePort = await findFreePort(preferred.console, occupied, probe);
  if (consolePort !== 0) occupied.add(consolePort);
  const mcp = await findFreePort(preferred.mcp, occupied, probe);
  return { app, console: consolePort, mcp };
}
