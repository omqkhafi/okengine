/**
 * Keyboard controls for a live `oke dev` session (TTY raw mode).
 *
 * Keys: `?` help · `q` quit · `c` refresh · `l` list · `u` up all ·
 * `x` stop all · `1`–`9` select service then `u`/`x`/`r`.
 *
 * Compose health / model phase update the status board above Logs — not
 * the log stream. `c` clears the TTY and reprints the latest board.
 */

import {
  formatStatusDot,
  formatStatusLine,
  termColorEnabled,
  termStyle,
  type DevStatus,
} from "../term.ts";

/** One Docker service row addressable by a digit key. */
export type DevControlService = {
  /** Human label (`ai`, `postgres`). */
  readonly label: string;
  /** Compose service name (`ai`, `store-sql`). */
  readonly serviceName: string;
};

/** Compose action against zero or more service names. */
export type DevComposeControlAction = "up" | "stop" | "restart";

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
   * Show help / services in a clean pane (typically refresh chrome first so
   * the panel is not interleaved with request logs).
   *
   * @param body - Formatted panel text
   */
  readonly onShowPanel?: (body: string) => void | Promise<void>;
  /**
   * After a compose up/stop/restart — sync health into the board (no log lines).
   */
  readonly onComposeSettled?: () => void | Promise<void>;
  /** Live service catalogue (unique compose services). */
  readonly services: () => readonly DevControlService[];
  /**
   * Run a compose control action.
   *
   * @param action - up / stop / restart
   * @param serviceNames - Empty → whole stack
   */
  readonly composeAction: (
    action: DevComposeControlAction,
    serviceNames: readonly string[],
  ) => Promise<void>;
  /** Optional live ● status for list view. */
  readonly statusOf?: (serviceName: string) => DevStatus | undefined;
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
    `${s.cyan}c${s.reset} refresh · ` +
    `${s.cyan}q${s.reset} quit · ` +
    `${s.cyan}l${s.reset} services · ` +
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
    k("c", "refresh — clear logs, show latest ●"),
    k("q", "quit oke dev"),
    k("l", "list docker services"),
    k("u", "compose up -d (all)"),
    k("x", "compose stop (all)"),
    k("1-9", "select service"),
    k("… u", "start selected"),
    k("… x", "stop selected"),
    k("… r", "restart selected"),
    k("esc", "clear selection"),
    bar,
    "",
  ].join("\n");
}

/**
 * Format a numbered service list for `l`.
 *
 * @param services - Catalogue
 * @param statusOf - Optional ● lookup
 * @param color - Color on/off
 * @param selected - Highlighted 1-based index
 */
export function formatDevControlsServiceList(
  services: readonly DevControlService[],
  statusOf?: (serviceName: string) => DevStatus | undefined,
  color: boolean = termColorEnabled(),
  selected?: number,
): string {
  const s = termStyle(color);
  const bar = `${s.dim}│${s.reset}`;
  if (services.length === 0) {
    return `${bar}  ${s.dim}no docker services${s.reset}\n`;
  }
  const lines = [
    "",
    `${s.green}◇${s.reset}  ${s.bold}Services${s.reset}  ${s.dim}1-9 then u/x/r${s.reset}`,
  ];
  const max = Math.min(9, services.length);
  for (let i = 0; i < max; i++) {
    const svc = services[i]!;
    const st = statusOf?.(svc.serviceName) ?? "pending";
    const dot = formatStatusDot(st, color);
    const num = `${i + 1}`;
    const mark = selected === i + 1 ? `${s.cyan}>${s.reset}` : " ";
    lines.push(
      `${bar}  ${mark}${s.cyan}${num}${s.reset}  ${dot}  ${svc.label.padEnd(12)}  ${s.dim}${svc.serviceName}${s.reset}`,
    );
  }
  if (services.length > 9) {
    lines.push(`${bar}  ${s.dim}… ${services.length - 9} more (first 9 only)${s.reset}`);
  }
  lines.push(bar);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Parse one raw stdin chunk into a control key (tests / non-TTY inject).
 *
 * @param chunk - Raw bytes/string
 */
export function parseDevControlKey(chunk: string): string | null {
  if (chunk.length === 0) return null;
  if (chunk === "\u0003") return "q"; // Ctrl+C
  if (chunk === "\u001b") return "esc";
  const ch = chunk[0]!;
  if (ch === "?" || ch === "h" || ch === "H") return "?";
  if (ch === "c" || ch === "C") return "c";
  if (ch === "q" || ch === "Q") return "q";
  if (ch === "l" || ch === "L") return "l";
  if (ch === "u" || ch === "U") return "u";
  if (ch === "x" || ch === "X") return "x";
  if (ch === "r" || ch === "R") return "r";
  if (ch >= "1" && ch <= "9") return ch;
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
 * @param opts - Quit / compose / services
 */
export function createDevControlDispatcher(opts: StartDevControlsOptions): DevControlDispatcher {
  const color = opts.color ?? termColorEnabled();
  let selected: number | null = null;
  let busy = false;
  let stopped = false;

  const runAction = async (
    action: DevComposeControlAction,
    serviceNames: readonly string[],
    _label: string,
  ): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await opts.composeAction(action, serviceNames);
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
      if (key === "c") {
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
      if (key === "esc") {
        selected = null;
        return;
      }
      if (key === "l") {
        const body = formatDevControlsServiceList(
          opts.services(),
          opts.statusOf,
          color,
          selected ?? undefined,
        );
        void Promise.resolve(opts.onShowPanel?.(body) ?? opts.write(body));
        return;
      }
      if (key >= "1" && key <= "9") {
        const n = Number(key);
        const list = opts.services();
        if (n < 1 || n > list.length || n > 9) {
          opts.write(formatStatusLine(`no service ${n} — press l to list`, color, "pending"));
          return;
        }
        selected = n;
        const svc = list[n - 1]!;
        opts.write(
          formatStatusLine(
            `selected ${n} ${svc.label} — u start · x stop · r restart · esc`,
            color,
            opts.statusOf?.(svc.serviceName) ?? "pending",
          ),
        );
        return;
      }
      if (key === "u" || key === "x" || key === "r") {
        const action: DevComposeControlAction =
          key === "u" ? "up" : key === "x" ? "stop" : "restart";
        if (selected !== null) {
          const list = opts.services();
          const svc = list[selected - 1];
          if (!svc) {
            selected = null;
            opts.write(formatStatusLine("selection expired — press l", color, "pending"));
            return;
          }
          selected = null;
          void runAction(action, [svc.serviceName], svc.label);
          return;
        }
        if (key === "r") {
          opts.write(formatStatusLine("select a service first (l then 1-9)", color, "pending"));
          return;
        }
        void runAction(action, [], "stack");
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
 * @param opts - Quit / compose / services
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

/**
 * Dedupe stack summary rows into control services (first label wins).
 *
 * @param rows - Stack summary services with compose names
 */
export function controlServicesFromStack(
  rows: readonly { readonly label: string; readonly serviceName?: string }[],
): DevControlService[] {
  const seen = new Set<string>();
  const out: DevControlService[] = [];
  for (const row of rows) {
    const name = row.serviceName?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ label: row.label, serviceName: name });
  }
  return out;
}
