/**
 * Headless `oke dev` controller — UI-agnostic lifecycle + events.
 *
 * Ink TUI and plain CLI both consume this; never kill a foreign pid.
 */

import { resolve } from "node:path";
import { APP_PORT, CONSOLE_PORT, DOCS_MCP_PORT, MCP_PORT } from "../runtime/types.ts";
import type { DevStatus } from "../term.ts";
import { type DevOptions, type DevSession, runDev } from "./dev.ts";
import {
  clearDevSessionLock,
  type DevOwnership,
  type DevSessionLock,
  type DevSessionPorts,
  probeDevPortsBusy,
  resolveDevOwnership,
  writeDevSessionLock,
} from "./dev-session-lock.ts";

/** Controller event kinds. */
export type DevControllerEvent =
  | { readonly type: "boot"; readonly phase: string; readonly detail?: string }
  | {
      readonly type: "ready";
      readonly ports: DevSessionPorts;
      readonly ownership: DevOwnership;
    }
  | {
      readonly type: "status";
      readonly service: string;
      readonly status: DevStatus;
      readonly detail?: string;
    }
  | { readonly type: "log"; readonly text: string }
  | { readonly type: "error"; readonly message: string; readonly fatal?: boolean }
  | {
      readonly type: "exit";
      readonly code: number;
      readonly signal?: string;
    }
  | { readonly type: "ownership"; readonly ownership: DevOwnership };

/** Listener for {@link DevController} events. */
export type DevControllerListener = (event: DevControllerEvent) => void;

/** Options for {@link DevController.start}. */
export type DevControllerStartOptions = Omit<DevOptions, "keepAlive" | "write" | "onReady"> & {
  readonly cwd?: string;
  /** Forward formatted chrome to stdout as well as events (default false). */
  readonly echoLogs?: boolean;
};

/**
 * Headless orchestration for a project’s dev stack.
 */
export class DevController {
  private readonly listeners = new Set<DevControllerListener>();
  private session: DevSession | null = null;
  private ownership: DevOwnership = "stopped";
  private lock: DevSessionLock | null = null;
  private starting = false;
  private readonly preferredPorts: DevSessionPorts;

  /**
   * @param preferredPorts - Default ports when probing without a lock
   */
  constructor(
    preferredPorts: DevSessionPorts = {
      app: APP_PORT,
      console: CONSOLE_PORT,
      mcp: MCP_PORT,
      docsMcp: DOCS_MCP_PORT,
    },
  ) {
    this.preferredPorts = preferredPorts;
  }

  /** Current ownership classification. */
  getOwnership(): DevOwnership {
    return this.ownership;
  }

  /** Live session when managed and started. */
  getSession(): DevSession | null {
    return this.session;
  }

  /** Last lock we wrote (managed only). */
  getLock(): DevSessionLock | null {
    return this.lock;
  }

  /**
   * Subscribe to controller events.
   *
   * @param listener - Callback
   */
  on(listener: DevControllerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emit an event to all listeners.
   *
   * @param event - Payload
   */
  emit(event: DevControllerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listeners must not break the controller
      }
    }
  }

  /**
   * Discover an existing stack without starting one.
   *
   * @param cwd - Project root
   */
  async attach(cwd: string = process.cwd()): Promise<{
    readonly ownership: DevOwnership;
    readonly lock: DevSessionLock | null;
    readonly busy: Awaited<ReturnType<typeof probeDevPortsBusy>>;
  }> {
    const root = resolve(cwd);
    const resolved = await resolveDevOwnership(root, this.preferredPorts);
    this.ownership = resolved.ownership;
    this.lock = resolved.lock;
    this.emit({ type: "ownership", ownership: this.ownership });
    if (this.ownership === "managed" || this.ownership === "external") {
      const ports = resolved.lock?.ports ?? this.preferredPorts;
      this.emit({
        type: "ready",
        ports,
        ownership: this.ownership,
      });
      this.emit({
        type: "log",
        text:
          this.ownership === "managed"
            ? "Attached to managed oke dev session\n"
            : "Connected to external oke dev (read-only)\n",
      });
    }
    return resolved;
  }

  /**
   * Start a managed session. Refuses if ports are already taken by another stack.
   *
   * @param options - Dev options (keepAlive forced false)
   */
  async start(options: DevControllerStartOptions = {}): Promise<number> {
    if (this.starting) {
      this.emit({ type: "error", message: "dev start already in progress" });
      return 1;
    }
    if (this.session) {
      this.emit({ type: "error", message: "dev session already running (managed)" });
      return 1;
    }

    const cwd = resolve(options.cwd ?? process.cwd());
    const attached = await this.attach(cwd);
    if (attached.ownership === "external") {
      this.emit({
        type: "error",
        message: "oke dev already running externally — attach only (will not start a second stack)",
        fatal: false,
      });
      return 1;
    }
    if (attached.ownership === "managed" && attached.lock && attached.lock.pid !== process.pid) {
      // Another managed process still alive — do not steal.
      this.emit({
        type: "error",
        message: `oke dev already managed by pid ${attached.lock.pid}`,
        fatal: false,
      });
      return 1;
    }

    this.starting = true;
    this.emit({ type: "boot", phase: "starting" });

    const echo = options.echoLogs === true;
    const write = (text: string): void => {
      this.emit({ type: "log", text });
      if (echo) process.stdout.write(text);
    };

    try {
      const result = await runDev({
        ...options,
        cwd,
        keepAlive: false,
        write,
        onReady: async (session) => {
          const ports: DevSessionPorts = {
            app: session.appPort,
            console: session.consolePort,
            mcp: session.mcpPort,
            docsMcp: session.docsMcpPort,
          };
          const lock: DevSessionLock = {
            pid: process.pid,
            ports,
            startedAt: new Date().toISOString(),
            cwd,
          };
          await writeDevSessionLock(cwd, lock);
          this.lock = lock;
          this.session = session;
          this.ownership = "managed";
          this.emit({ type: "ownership", ownership: "managed" });
          this.emit({ type: "ready", ports, ownership: "managed" });
          this.emit({ type: "boot", phase: "ready" });
        },
      });

      if (result.code !== 0 || !result.session) {
        this.ownership = "stopped";
        this.session = null;
        this.emit({ type: "error", message: "oke dev failed to start", fatal: true });
        this.emit({ type: "exit", code: result.code });
        return result.code;
      }

      // onReady may have already set session; ensure we hold it.
      this.session = result.session;
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: "error", message, fatal: true });
      this.emit({ type: "exit", code: 1 });
      return 1;
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stop only a session this controller owns. Never kills an external pid.
   */
  async stop(): Promise<void> {
    if (this.ownership === "external") {
      this.emit({
        type: "error",
        message: "refusing to stop external oke dev session",
        fatal: false,
      });
      return;
    }
    if (this.ownership !== "managed" || !this.session) {
      this.ownership = "stopped";
      this.emit({ type: "ownership", ownership: "stopped" });
      return;
    }

    const cwd = this.lock?.cwd ?? process.cwd();
    try {
      this.session.stop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: "error", message });
    }
    this.session = null;
    this.lock = null;
    this.ownership = "stopped";
    await clearDevSessionLock(cwd);
    this.emit({ type: "ownership", ownership: "stopped" });
    this.emit({ type: "exit", code: 0 });
  }

  /**
   * Stop then start (managed only).
   *
   * @param options - Start options
   */
  async restart(options: DevControllerStartOptions = {}): Promise<number> {
    if (this.ownership === "external") {
      this.emit({
        type: "error",
        message: "cannot restart an external oke dev session",
        fatal: false,
      });
      return 1;
    }
    await this.stop();
    return this.start(options);
  }
}
