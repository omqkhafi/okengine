/**
 * Poll preferred OKE ports for the Dashboard.
 */

import { APP_PORT, CONSOLE_PORT, DOCS_MCP_PORT, MCP_PORT } from "../../../runtime/types.ts";
import type { DevStatus } from "../../../term.ts";
import { isPortInUse } from "../../ports.ts";
import {
  type DevOwnership,
  type DevSessionPorts,
  resolveDevOwnership,
} from "../../dev-session-lock.ts";

/** One surface row on the dashboard. */
export type SurfaceStatus = {
  readonly id: "app" | "console" | "mcp" | "docsMcp";
  readonly label: string;
  readonly port: number;
  readonly status: DevStatus;
  readonly url: string;
};

/** Snapshot for Dashboard / Dev panel. */
export type PortSnapshot = {
  readonly ownership: DevOwnership;
  readonly surfaces: readonly SurfaceStatus[];
};

/**
 * Preferred ports (config overrides later if needed).
 *
 * @param cwd - Project root
 */
export async function pollPortSnapshot(
  cwd: string,
  preferred: DevSessionPorts = {
    app: APP_PORT,
    console: CONSOLE_PORT,
    mcp: MCP_PORT,
    docsMcp: DOCS_MCP_PORT,
  },
): Promise<PortSnapshot> {
  const { ownership, lock, busy } = await resolveDevOwnership(cwd, preferred);
  const ports = lock?.ports ?? preferred;
  const toStatus = (busyPort: boolean): DevStatus => (busyPort ? "ready" : "idle");
  return {
    ownership,
    surfaces: [
      {
        id: "app",
        label: "App",
        port: ports.app,
        status: toStatus(busy.app),
        url: `http://127.0.0.1:${ports.app}`,
      },
      {
        id: "console",
        label: "Console",
        port: ports.console,
        status: toStatus(busy.console),
        url: `http://127.0.0.1:${ports.console}`,
      },
      {
        id: "mcp",
        label: "MCP",
        port: ports.mcp,
        status: toStatus(busy.mcp),
        url: `http://127.0.0.1:${ports.mcp}`,
      },
      {
        id: "docsMcp",
        label: "Docs MCP",
        port: ports.docsMcp,
        status: toStatus(busy.docsMcp),
        url: `http://127.0.0.1:${ports.docsMcp}`,
      },
    ],
  };
}

/**
 * Light HTTP probe — upgrades idle→error when port open but not answering.
 *
 * @param url - Base URL
 */
export async function probeHttpOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export { isPortInUse };
