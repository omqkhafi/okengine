/**
 * Keyboard controls for a live `oke dev` session (TTY raw mode).
 *
 * Keys: `?` help · `q` quit · `r` refresh · `u` up all · `x` stop all.
 *
 * Compose health / model phase update the status board above Logs — it
 * already lists every service with a live ● status, so refresh alone is
 * enough to see the stack; there is no separate services panel.
 */

import { formatStatusLine, termColorEnabled, termStyle } from "../term.ts";

/** Compose action against the whole stack. */
export type DevComposeControlAction = "up" | "stop";

/** Options for {@link startDevControls}. */
export type StartDevControlsOptions = {
  readonly write: (text: string) => void;
  /** Called on `q` / Ctrl+C. */
  readonly onQuit: () => void;
  /**
   * Clear the TTY and reprint chrome + latest status board (drops log noise).
   */
  readonly onRefresh?: () => void | Promise<void>;
  /**
   * Show help in a clean pane (refreshes chrome first so the panel is not
   * interleaved with request logs).
   *
   * @param body - Formatted panel text
   */
  readonly onShowPanel?: (body: string) => void | Promise<void>;
  /**
   * After a compose up/stop — sync health into the board (no log lines).
   */
  readonly onComposeSettled?: () => void | Promise<void>;
  /**
   * Run a compose control action against the whole stack.
   *
   * @param action - up / stop
   */
  readonly composeAction: (action: DevComposeControlAction) => Promise<void>;
  readonly stdin?: NodeJS.ReadStream;
  readonly isTTY?: boolean;
  readonly color?: boolean;
};

/** Handle returned by {@link startDevControls}. */
export type DevControlsHandle = {
  readonly stop: () => void;
};

/**
 * One-line keys hint under Logs.
 *
 * @param color - Color on/off
 */
export function formatDevControlsHint(color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  return (
    `${s.dim}│${s.reset}  ${s.dim}keys${s.reset}  ` +
    `${s.cyan}?${s.reset} help · ` +
    `${s.cyan}r${s.reset} refresh · ` +
    `${s.cyan}q${s.reset} quit · ` +
    `${s.cyan}u${s.reset} up · ` +
    `${s.cyan}x${s.reset} stop` +
    `\n`
  );
}

/**
 * Full help block for `?` / `h`.
 *
 * @param color - Color on/off
 */
export function formatDevControlsHelp(color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  const bar = `${s.dim}│${s.reset}`;
  const k = (key: string, meaning: string) =>
    `${bar}  ${s.cyan}${key.padEnd(6)}${s.reset}  ${s.dim}${meaning}${s.reset}`;
  return [
    "",
    `${s.green}◇${s.reset}  ${s.bold}Keys${s.reset}`,
    k("?", "help"),
    k("r", "refresh — clear logs, show latest ●"),
    k("q", "quit oke dev"),
    k("u", "compose up -d (all)"),
    k("x", "compose stop (all)"),
    bar,
    "",
  ].join("\n");
}

/**
 * Parse one raw stdin chunk into a control key (tests / non-TTY inject).
 *
 * @param chunk - Raw bytes/string
 */
export function parseDevControlKey(chunk: string): string | null {
  if (chunk.length === 0) return null;
  if (chunk === "\u0003") return "q"; // Ctrl+C
  const ch = chunk[0]!;
  if (ch === "?" || ch === "h" || ch === "H") return "?";
  if (ch === "q" || ch === "Q") return "q";
  if (ch === "r" || ch === "R") return "r";
  if (ch === "u" || ch === "U") return "u";
  if (ch === "x" || ch === "X") return "x";
  return null;
}

/** Key dispatcher for tests and {@link startDevControls}. */
export type DevControlDispatcher = {
  readonly handleKey: (key: string) => void;
  readonly stop: () => void;
};

/**
 * Pure key dispatcher (no stdin) — used by tests and the TTY listener.
 *
 * @param opts - Quit / compose actions
 */
export function createDevControlDispatcher(opts: StartDevControlsOptions): DevControlDispatcher {
  const color = opts.color ?? termColorEnabled();
  let busy = false;
  let stopped = false;

  const runAction = async (action: DevComposeControlAction): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await opts.composeAction(action);
      await opts.onComposeSettled?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.write(formatStatusLine(`${action} failed — ${msg}`, color, "error"));
    } finally {
      busy = false;
    }
  };

  return {
    handleKey(key: string): void {
      if (stopped) return;
      if (key === "q") {
        opts.onQuit();
        return;
      }
      if (key === "r") {
        void Promise.resolve(opts.onRefresh?.()).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          opts.write(formatStatusLine(`refresh failed — ${msg}`, color, "error"));
        });
        return;
      }
      if (key === "?") {
        const body = formatDevControlsHelp(color);
        void Promise.resolve(opts.onShowPanel?.(body) ?? opts.write(body));
        return;
      }
      if (key === "u" || key === "x") {
        void runAction(key === "u" ? "up" : "stop");
      }
    },
    stop() {
      stopped = true;
    },
  };
}

/**
 * Start raw-mode keyboard controls. No-op when stdin is not a TTY.
 *
 * @param opts - Quit / compose actions
 */
export function startDevControls(opts: StartDevControlsOptions): DevControlsHandle {
  const stdin = opts.stdin ?? process.stdin;
  const isTTY = opts.isTTY ?? stdin.isTTY === true;
  const dispatcher = createDevControlDispatcher(opts);

  if (!isTTY || typeof stdin.setRawMode !== "function") {
    return { stop: () => dispatcher.stop() };
  }

  const onData = (buf: string | Buffer): void => {
    const chunk = typeof buf === "string" ? buf : buf.toString("utf8");
    const key = parseDevControlKey(chunk);
    if (key) dispatcher.handleKey(key);
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", onData);

  return {
    stop() {
      dispatcher.stop();
      stdin.off("data", onData);
      try {
        if (typeof stdin.setRawMode === "function") stdin.setRawMode(false);
      } catch {
        // already closed
      }
    },
  };
}
