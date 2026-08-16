/**
 * Clack-inspired terminal styling for `oke` CLI / boot logs.
 *
 * Human TTY gets color + unicode chrome; CI / pipes stay plain.
 * Flip to monochrome with `NO_COLOR=1` or non-TTY stdout.
 */

/** Whether ANSI color should be applied. */
export function termColorEnabled(stream: { readonly isTTY?: boolean } = process.stdout): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] === "0") return false;
  if (process.env["FORCE_COLOR"]) return true;
  return stream.isTTY === true;
}

const ESC = "\u001b[";

/** ANSI helpers — empty strings when color is off. */
export type TermStyle = {
  readonly reset: string;
  readonly bold: string;
  readonly dim: string;
  readonly cyan: string;
  readonly green: string;
  readonly magenta: string;
  readonly yellow: string;
  readonly white: string;
  readonly red: string;
};

/**
 * Build a style palette for the current environment.
 *
 * @param color - Force on/off; default from {@link termColorEnabled}
 */
export function termStyle(color: boolean = termColorEnabled()): TermStyle {
  if (!color) {
    return {
      reset: "",
      bold: "",
      dim: "",
      cyan: "",
      green: "",
      magenta: "",
      yellow: "",
      white: "",
      red: "",
    };
  }
  return {
    reset: `${ESC}0m`,
    bold: `${ESC}1m`,
    dim: `${ESC}2m`,
    cyan: `${ESC}36m`,
    green: `${ESC}32m`,
    magenta: `${ESC}35m`,
    yellow: `${ESC}33m`,
    white: `${ESC}37m`,
    red: `${ESC}31m`,
  };
}

/**
 * Readiness for hero / Docker status dots.
 *
 * - `ready` — green ●
 * - `pending` — yellow ● (starting / loading)
 * - `error` — red ●
 * - `idle` — dim ● (unbound)
 */
export type DevStatus = "ready" | "pending" | "error" | "idle";

/**
 * Colored ● for {@link DevStatus}.
 *
 * @param status - Readiness
 * @param color - Color on/off
 */
export function formatStatusDot(status: DevStatus, color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  switch (status) {
    case "ready":
      return `${s.green}●${s.reset}`;
    case "pending":
      return `${s.yellow}●${s.reset}`;
    case "error":
      return `${s.red}●${s.reset}`;
    case "idle":
      return `${s.dim}●${s.reset}`;
  }
}

/**
 * Map AI model phase → {@link DevStatus}.
 *
 * @param phase - Probe phase string
 */
export function devStatusFromAiPhase(
  phase: "unreachable" | "starting" | "loading" | "ready" | "error" | string,
): DevStatus {
  if (phase === "ready") return "ready";
  if (phase === "error") return "error";
  if (phase === "unreachable" || phase === "starting" || phase === "loading") return "pending";
  return "pending";
}

/** One eight-element row in the hero. */
export type DevHeroElement = {
  readonly element: string;
  readonly detail: string;
  /** Status dot (default: idle when detail is `—`, else ready). */
  readonly status?: DevStatus;
};

/** Shared options for the `oke dev` hero / banner. */
export type DevHeroMeta = {
  /** `local` · `docker` · `test` · `production` */
  readonly profile?: string;
  /** Data plane: `local` · `production` */
  readonly runtimeEnv?: string;
  /** Host OS + Bun, e.g. `darwin 25.4.0 · bun 1.3.14`. */
  readonly system?: string;
  /** Active drivers for the eight elements. */
  readonly elements?: readonly DevHeroElement[];
  readonly version?: string;
  readonly color?: boolean;
  readonly watching?: boolean;
  /** Banner verb — `Starting` during boot, `Ready` after surfaces bind. */
  readonly phase?: "starting" | "ready";
};

/**
 * Compact OKE wordmark — CRT / hacker block letters.
 *
 * @param color - Color on/off
 */
export function formatOkeWordmark(color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  const ink = `${s.green}${s.bold}`;
  const r = s.reset;
  return (
    [
      `${ink}   ██████╗ ██╗  ██╗███████╗${r}`,
      `${ink}  ██╔═══██╗██║ ██╔╝██╔════╝${r}`,
      `${ink}  ██║   ██║█████╔╝ █████╗  ${r}`,
      `${ink}  ██║   ██║██╔═██╗ ██╔══╝  ${r}`,
      `${ink}  ╚██████╔╝██║  ██╗███████╗${r}`,
      `${ink}   ╚═════╝ ╚═╝  ╚═╝╚══════╝${r}`,
    ].join("\n") + "\n"
  );
}

/**
 * Detail rows — profile, env, system, eight elements + drivers.
 *
 * @param options - Snapshot fields from {@link import("./cli/hero-meta.ts").buildDevHeroSnapshot}
 */
export function formatDevHeroDetails(options: DevHeroMeta = {}): string {
  const s = termStyle(options.color ?? termColorEnabled());
  const bar = `${s.dim}│${s.reset}`;
  const label = (name: string) => `${s.dim}${name.padEnd(9)}${s.reset}`;
  const lines: string[] = [];
  if (options.profile) {
    lines.push(`${bar}  ${label("profile")} ${s.cyan}${options.profile}${s.reset}`);
  }
  if (options.runtimeEnv) {
    lines.push(`${bar}  ${label("env")} ${s.cyan}${options.runtimeEnv}${s.reset}`);
  }
  if (options.system) {
    lines.push(`${bar}  ${label("system")} ${s.dim}${options.system}${s.reset}`);
  }
  const elements = options.elements ?? [];
  if (elements.length > 0) {
    lines.push(`${bar}  ${s.dim}elements${s.reset}`);
    const color = options.color ?? termColorEnabled();
    for (const row of elements) {
      const idle = row.detail === "—" || row.detail === "";
      const status = row.status ?? (idle ? "idle" : "ready");
      const dot = formatStatusDot(status, color);
      const detail = idle
        ? row.detail === ""
          ? ""
          : `${s.dim}—${s.reset}`
        : `${s.cyan}${row.detail}${s.reset}`;
      const detailPart = detail ? ` ${detail}` : "";
      lines.push(`${bar}  ${dot} ${s.dim}${row.element.padEnd(9)}${s.reset}${detailPart}`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/**
 * `oke dev` intro — wordmark + details; service URLs print as each surface binds.
 *
 * @param options - Color / watch / ports / entry
 */
export function formatDevBanner(options: DevHeroMeta = {}): string {
  const s = termStyle(options.color ?? termColorEnabled());
  const bar = `${s.dim}│${s.reset}`;
  const lines = [
    "",
    formatOkeWordmark(options.color ?? termColorEnabled()).trimEnd(),
    `${s.cyan}${s.bold}┌${s.reset}  ${s.bold}oke dev${s.reset}` +
      (options.version ? `  ${s.dim}v${options.version}${s.reset}` : ""),
    bar,
    `${s.green}◇${s.reset}  ${options.phase === "ready" ? "Ready" : "Starting"}`,
  ];
  if (options.watching !== false) {
    lines.push(`${bar}  ${s.dim}watching — client types regenerate on save${s.reset}`);
  }
  const details = formatDevHeroDetails(options).trimEnd();
  if (details) lines.push(details);
  lines.push(bar);
  return `${lines.join("\n")}\n`;
}

/**
 * Count visual lines in a terminal string (trailing newline optional).
 *
 * @param text - Block text
 */
export function countTermLines(text: string): number {
  if (text.length === 0) return 0;
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (normalized.length === 0) return 0;
  return normalized.split("\n").length;
}

/** Handle for a bottom-of-TTY block that can be repainted until frozen. */
export type RewritableBlock = {
  /** Paint / repaint the block (must still be the last output). */
  readonly paint: (text: string) => void;
  /** Erase the block in place (no-op when frozen or non-TTY). */
  readonly clear: () => void;
  /** Stop rewriting — further {@link paint} calls append instead. */
  readonly freeze: () => void;
  readonly frozen: () => boolean;
};

/**
 * Erase `lineCount` lines above the cursor (cursor ends on the first cleared row).
 *
 * @param write - stdout writer
 * @param lineCount - Rows to clear
 */
function eraseTermLines(write: (text: string) => void, lineCount: number): void {
  if (lineCount <= 0) return;
  write(`\x1b[${lineCount}A`);
  for (let i = 0; i < lineCount; i++) {
    write("\x1b[2K");
    if (i < lineCount - 1) write("\x1b[1B");
  }
  if (lineCount > 1) write(`\x1b[${lineCount - 1}A`);
}

/**
 * Bottom-anchored live block for hero elements / Docker summary.
 *
 * Repaints in place with ANSI cursor moves while at the bottom of the TTY.
 * Call {@link RewritableBlock.freeze} before printing anything below it.
 *
 * @param write - stdout writer
 * @param enabled - When false (non-TTY / tests), every paint appends
 */
export function createRewritableBlock(
  write: (text: string) => void,
  enabled: boolean = termColorEnabled() && process.stdout.isTTY === true,
): RewritableBlock {
  let lineCount = 0;
  let frozen = false;
  return {
    paint(text: string) {
      if (text.length === 0) {
        this.clear();
        return;
      }
      const body = text.endsWith("\n") ? text : `${text}\n`;
      const nextLines = countTermLines(body);
      if (!frozen && enabled && lineCount > 0) {
        eraseTermLines(write, lineCount);
      }
      write(body);
      if (!frozen && enabled) lineCount = nextLines;
      else lineCount = 0;
    },
    clear() {
      if (frozen) return;
      if (enabled && lineCount > 0) eraseTermLines(write, lineCount);
      lineCount = 0;
    },
    freeze() {
      frozen = true;
      lineCount = 0;
    },
    frozen: () => frozen,
  };
}

/** Keyed ephemeral boot-progress lines (compose / vault / health / AI). */
export type BootProgress = {
  /** Set or replace a progress row by key, then repaint. */
  readonly set: (key: string, line: string) => void;
  /** Erase all progress rows (TTY) before the final board. */
  readonly clear: () => void;
};

/**
 * Live boot-progress pane — keyed rows replace in place, then {@link BootProgress.clear}.
 *
 * @param write - stdout writer
 * @param enabled - TTY rewrite on/off
 */
export function createBootProgress(
  write: (text: string) => void,
  enabled: boolean = termColorEnabled() && process.stdout.isTTY === true,
): BootProgress {
  const block = createRewritableBlock(write, enabled);
  const order: string[] = [];
  const lines = new Map<string, string>();
  const repaint = (): void => {
    if (order.length === 0) {
      block.clear();
      return;
    }
    block.paint(order.map((key) => lines.get(key) ?? "").join(""));
  };
  return {
    set(key: string, line: string) {
      const body = line.endsWith("\n") ? line : `${line}\n`;
      if (!lines.has(key)) order.push(key);
      lines.set(key, body);
      if (!enabled) {
        write(body);
        return;
      }
      repaint();
    },
    clear() {
      order.length = 0;
      lines.clear();
      block.clear();
    },
  };
}

/** Live elements/Docker board that can rewrite after content is printed below. */
export type AnchoredBoard = {
  /**
   * Paint or rewrite the board. A taller body (claim code, extra Docker
   * rows) inserts lines so Backend / Logs below are pushed down, not overwritten.
   */
  readonly paint: (text: string) => void;
  /** Wrap a writer so post-board output is tracked for cursor math. */
  readonly wrapWrite: (inner: (text: string) => void) => (text: string) => void;
  /**
   * Forget board geometry (after a full-screen clear) so the next
   * {@link paint} writes fresh at the cursor.
   */
  readonly reset: () => void;
  /** Disable further in-place rewrites (session end). */
  readonly stop: () => void;
};

/**
 * Rows added when an anchored board grows (claim pane, extra Docker rows).
 *
 * @param previous - Last painted body
 * @param next - Next painted body
 */
export function grownBoardTail(previous: string, next: string): string {
  const prevBody = previous.endsWith("\n") ? previous.slice(0, -1) : previous;
  const nextBody = next.endsWith("\n") ? next.slice(0, -1) : next;
  const prevLines = prevBody.length === 0 ? 0 : prevBody.split("\n").length;
  const nextRows = nextBody.length === 0 ? [] : nextBody.split("\n");
  if (nextRows.length <= prevLines) return "";
  return `${nextRows.slice(prevLines).join("\n")}\n`;
}

/**
 * Anchored status board — rewrites in place even after Backend / Logs lines.
 *
 * Growing inserts rows (`CSI n L`) so content below shifts down. Shrinking
 * deletes the leftover rows. Soft-reload full-screen clears can desync;
 * {@link AnchoredBoard.reset} then paints fresh at the cursor.
 *
 * @param write - stdout writer
 * @param enabled - TTY rewrite on/off
 */
export function createAnchoredBoard(
  write: (text: string) => void,
  enabled: boolean = termColorEnabled() && process.stdout.isTTY === true,
): AnchoredBoard {
  let boardLines = 0;
  let belowLines = 0;
  let stopped = false;
  let lastBody = "";

  return {
    paint(text: string) {
      if (stopped) return;
      const body = text.endsWith("\n") ? text : `${text}\n`;
      const nextLines = countTermLines(body);
      if (!enabled) {
        if (boardLines === 0) {
          write(body);
        } else if (body !== lastBody) {
          const tail = grownBoardTail(lastBody, body);
          if (tail.length > 0) write(tail);
        }
        boardLines = nextLines;
        lastBody = body;
        return;
      }
      if (boardLines === 0) {
        write(body);
        boardLines = nextLines;
        lastBody = body;
        return;
      }
      if (body === lastBody) return;
      const grew = nextLines - boardLines;
      // Cursor sits after the below-board output. Move onto the first
      // below line (or stay after the board when nothing is below).
      if (belowLines > 0) write(`\x1b[${belowLines}A`);
      if (grew > 0 && belowLines > 0) {
        write(`\x1b[${grew}L`);
      }
      eraseTermLines(write, boardLines);
      write(body);
      if (grew < 0 && belowLines > 0) {
        write(`\x1b[${-grew}M`);
      }
      if (belowLines > 0) write(`\x1b[${belowLines}B`);
      boardLines = nextLines;
      lastBody = body;
    },
    wrapWrite(inner: (text: string) => void) {
      return (text: string) => {
        if (!stopped && enabled && boardLines > 0) {
          belowLines += countTermLines(text);
        }
        inner(text);
      };
    },
    reset() {
      boardLines = 0;
      belowLines = 0;
      lastBody = "";
    },
    stop() {
      stopped = true;
    },
  };
}

/**
 * One service URL line (Console / MCP after bind).
 *
 * @param label - Surface name
 * @param url - Absolute URL
 * @param color - Color on/off
 */
export function formatServiceLine(
  label: string,
  url: string,
  color: boolean = termColorEnabled(),
): string {
  const s = termStyle(color);
  const pad = label.padEnd(7);
  return `${s.dim}│${s.reset}  ${s.dim}${pad}${s.reset}  ${s.cyan}${url}${s.reset}\n`;
}

/**
 * Backend child ready line (`bun --hot` soft reload).
 *
 * @param url - Backend base URL
 * @param color - Color on/off
 */
export function formatAppReadyLine(url: string, color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  return `${s.green}●${s.reset}  ${s.dim}${"Backend".padEnd(7)}${s.reset}  ${s.cyan}${url}${s.reset}\n`;
}

/**
 * ANSI clear screen + home (drops request logs; hero is reprinted after).
 */
export function clearTerminalScreen(): string {
  return "\u001b[2J\u001b[3J\u001b[H";
}

/**
 * Compact hero (banner + URLs + Logs). Tests use this; the `bun --hot`
 * child must not print it — a full reprint would wipe the claim pane.
 *
 * @param options - Surface base URLs + meta
 */
export function formatDevHero(
  options: DevHeroMeta & {
    readonly appUrl: string;
    readonly consoleUrl: string;
    readonly mcpUrl: string;
  },
): string {
  const color = options.color ?? termColorEnabled();
  const s = termStyle(color);
  const bar = `${s.dim}│${s.reset}`;
  return (
    `\n${formatOkeWordmark(color)}` +
    `${s.cyan}${s.bold}┌${s.reset}  ${s.bold}oke dev${s.reset}` +
    (options.version ? `  ${s.dim}v${options.version}${s.reset}` : "") +
    `\n${bar}\n` +
    formatDevHeroDetails({ ...options, color }) +
    `${bar}\n` +
    formatAppReadyLine(options.appUrl, color) +
    formatServiceLine("Console", options.consoleUrl, color) +
    formatServiceLine("MCP", options.mcpUrl, color) +
    formatDevLogSeparator(color)
  );
}

/**
 * Closes the hero block and opens the Logs section.
 *
 * @param color - Color on/off
 */
export function formatDevLogSeparator(color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  return (
    `${s.dim}│${s.reset}\n` +
    `${s.dim}└${s.reset}\n` +
    `\n${s.green}◇${s.reset}  ${s.bold}Logs${s.reset}\n` +
    `${s.dim}│${s.reset}\n\n`
  );
}

/**
 * Quiet status line (regen, …).
 *
 * @param message - Status text
 * @param color - Color on/off
 * @param status - Optional colored ● prefix
 */
export function formatStatusLine(
  message: string,
  color: boolean = termColorEnabled(),
  status?: DevStatus,
): string {
  const s = termStyle(color);
  const dot = status ? `${formatStatusDot(status, color)} ` : "";
  return `${s.dim}│${s.reset}  ${dot}${s.dim}${message}${s.reset}\n`;
}

/**
 * Wrap a long message to `width` columns (word-aware).
 *
 * @param text - Source text
 * @param width - Max columns per line
 */
function wrapWords(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (cur.length === 0) {
      cur = word;
      continue;
    }
    if (`${cur} ${word}`.length <= width) {
      cur = `${cur} ${word}`;
      continue;
    }
    lines.push(cur);
    cur = word;
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/** Tone for {@link formatDevNote} — warning (4xx / boot) or error (5xx). */
export type DevNoteTone = "warn" | "error";

/**
 * House note block — title chip on its own row, body underneath.
 * Same column as Claim / Docker: `◇  Title` then `│` then `│  body`.
 *
 * @param options - Title, body, tone
 */
export function formatDevNote(options: {
  readonly title: string;
  readonly body: string;
  readonly tone?: DevNoteTone;
  readonly color?: boolean;
}): string {
  const s = termStyle(options.color ?? termColorEnabled());
  const ink = options.tone === "error" ? s.red : s.yellow;
  const bar = `${s.dim}│${s.reset}`;
  const width = Math.max(40, Math.min(72, (process.stdout.columns ?? 80) - 6));
  const wrapped = wrapWords(options.body.trim(), width);
  const lines = [`${ink}◇${s.reset}  ${s.bold}${ink}${options.title}${s.reset}`, bar];
  for (const line of wrapped) {
    lines.push(`${bar}  ${ink}${line}${s.reset}`);
  }
  lines.push(bar);
  return `${lines.join("\n")}\n`;
}

/**
 * Boot honesty notice — Clack-like column under the `oke dev` hero.
 *
 * @param message - Body (with or without `oke boot:` prefix)
 * @param color - Color on/off
 */
export function formatBootWarn(message: string, color: boolean = termColorEnabled()): string {
  const body = message.replace(/^oke boot:\s*/i, "").trim();
  return formatDevNote({ title: "Notice", body, tone: "warn", color });
}

/**
 * Route raw CLI / boot lines into hero chrome (`│  …` or Notice boxes).
 *
 * @param text - Chunk that may contain newlines
 * @param color - Color on/off
 */
export function formatCliChrome(text: string, color: boolean = termColorEnabled()): string {
  const parts = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!;
    const isLastEmpty = i === parts.length - 1 && line.length === 0;
    if (isLastEmpty) continue;
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;
    if (/^oke boot:/i.test(trimmed)) {
      out.push(formatBootWarn(trimmed, color));
      continue;
    }
    out.push(formatStatusLine(trimmed, color));
  }
  return out.join("");
}

/** One infra service row for {@link formatStackSummary}. */
export type StackSummaryService = {
  /** Human label (`postgres`, `redis`). */
  readonly label: string;
  /** Published host port. */
  readonly hostPort: number;
  /** Optional trailing detail (e.g. AI model id). */
  readonly detail?: string;
  /** Status dot (default `pending` until probed). */
  readonly status?: DevStatus;
  /** Compose service name for health lookup (`ai`, `store-sql`). */
  readonly serviceName?: string;
};

/** Surfaces that emit request lines during `oke dev`. */
export type DevLogSurface = "Backend" | "Console" | "MCP";

/**
 * Local calendar date `YYYY-MM-DD` (no time).
 *
 * @param at - Instant (default now)
 */
export function formatDevLogDate(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Local clock time `HH:MM:SS` (no date).
 *
 * @param at - Instant (default now)
 */
export function formatDevLogTime(at: Date = new Date()): string {
  const h = String(at.getHours()).padStart(2, "0");
  const min = String(at.getMinutes()).padStart(2, "0");
  const sec = String(at.getSeconds()).padStart(2, "0");
  return `${h}:${min}:${sec}`;
}

/**
 * One HTTP/RPC request line for the `oke dev` TTY.
 *
 * @example
 * `●  Backend GET  /health                 main.health            12ms  200  2026-07-26  03:11:42  a1b2c3d4-…`
 *
 * 4xx/5xx append a house note (`◇  401` then the message), not a dim `↳`.
 *
 * @param options - Surface, method, path, flow, timing, status, run id
 */
export function formatRequestLine(options: {
  readonly surface: DevLogSurface;
  readonly method: string;
  readonly path: string;
  readonly flow?: string;
  readonly status: number;
  readonly ms: number;
  /** Instant for date/time columns (default now). */
  readonly at?: Date;
  readonly color?: boolean;
  /** Failure detail printed on a follow-up line (4xx/5xx). */
  readonly detail?: string;
  /** WideEvent / run id when the request executed a flow. */
  readonly runId?: string;
}): string {
  const s = termStyle(options.color ?? termColorEnabled());
  const at = options.at ?? new Date();
  const date = formatDevLogDate(at);
  const time = formatDevLogTime(at);
  const surfaceColor =
    options.surface === "Backend" ? s.green : options.surface === "Console" ? s.magenta : s.cyan;
  const statusColor = options.status >= 500 ? s.red : options.status >= 400 ? s.yellow : s.green;
  const methodRaw = options.method.toUpperCase();
  const methodColor =
    methodRaw === "GET" || methodRaw === "QUERY"
      ? s.green
      : methodRaw === "POST"
        ? s.yellow
        : methodRaw === "PUT" || methodRaw === "PATCH"
          ? s.magenta
          : methodRaw === "DELETE"
            ? s.red
            : s.cyan;
  const method = methodRaw.padEnd(6);
  const path = options.path.length > 28 ? `${options.path.slice(0, 27)}…` : options.path.padEnd(28);
  const flow = (options.flow ?? "—").padEnd(22);
  const ms = `${options.ms}ms`.padStart(6);
  const runId = options.runId?.trim();
  const run = runId && runId.length > 0 ? `  ${s.dim}${runId}${s.reset}` : "";
  const main =
    `${surfaceColor}●${s.reset}  ` +
    `${surfaceColor}${options.surface.padEnd(7)}${s.reset}  ` +
    `${methodColor}${method}${s.reset} ` +
    `${s.cyan}${path}${s.reset}  ` +
    `${s.dim}${flow}${s.reset}  ` +
    `${s.dim}${ms}${s.reset}  ` +
    `${statusColor}${options.status}${s.reset}  ` +
    `${s.dim}${date}${s.reset}  ` +
    `${s.dim}${time}${s.reset}` +
    `${run}\n`;
  const detail = options.detail?.trim();
  if (!detail || options.status < 400) return main;
  const tone: DevNoteTone = options.status >= 500 ? "error" : "warn";
  const note = formatDevNote({
    title: String(options.status),
    body: detail,
    tone,
    color: options.color ?? termColorEnabled(),
  });
  return `${main}${s.dim}│${s.reset}\n${note}`;
}

/**
 * Compact `oke dev -s` summary — project, ports, app driver mode.
 *
 * @param options - Project name, services, driver labels
 */
export function formatStackSummary(options: {
  readonly project: string;
  readonly services: readonly StackSummaryService[];
  /** Drivers the host app will use (e.g. `postgres`, `redis`). */
  readonly appDrivers?: readonly string[];
  readonly color?: boolean;
}): string {
  const s = termStyle(options.color ?? termColorEnabled());
  const bar = `${s.dim}│${s.reset}`;
  const pad = (label: string) => label.padEnd(8);
  const color = options.color ?? termColorEnabled();
  const lines: string[] = [
    `${s.dim}│${s.reset}`,
    `${s.green}◇${s.reset}  ${s.bold}Docker${s.reset}     ${s.cyan}${options.project}${s.reset}`,
  ];
  for (const svc of options.services) {
    const detail = svc.detail?.trim();
    const status = svc.status ?? "pending";
    const dot = formatStatusDot(status, color);
    lines.push(
      `${bar}  ${dot} ${s.dim}${pad(svc.label)}${s.reset}  ${s.cyan}:${svc.hostPort}${s.reset}` +
        (detail ? `  ${s.dim}${detail}${s.reset}` : ""),
    );
  }
  const drivers = options.appDrivers ?? [];
  const appDetail = drivers.length > 0 ? `host Bun · ${drivers.join(" + ")}` : "host Bun";
  const appDot = formatStatusDot("ready", color);
  lines.push(`${bar}  ${appDot} ${s.dim}${pad("app")}${s.reset}  ${s.dim}${appDetail}${s.reset}`);
  lines.push(bar);
  return `${lines.join("\n")}\n`;
}

/**
 * First-admin claim code note (clack `note`-style box).
 * Stays on the `oke dev` board — never sent to the Console HTTP API.
 *
 * @param code - Hex claim code
 * @param color - Color on/off
 * @param options - Optional Console URL for the paste hint
 */
export function formatClaimNote(
  code: string,
  color: boolean = termColorEnabled(),
  options: { readonly consoleUrl?: string } = {},
): string {
  const s = termStyle(color);
  const bar = `${s.dim}│${s.reset}`;
  const title = "Claim code";
  const hint = "expires in 30 min";
  const paste = options.consoleUrl
    ? `Paste at ${options.consoleUrl}  ·  oke console claim-code`
    : "oke console claim-code";
  const ownership = "Whoever can read this log already owns the server.";
  const lines = [
    `${s.magenta}◆${s.reset}  ${s.bold}${title}${s.reset}  ${s.dim}${hint}${s.reset}`,
    bar,
    `${bar}  ${s.bold}${code}${s.reset}`,
    bar,
    `${bar}  ${s.dim}${paste}${s.reset}`,
    `${bar}  ${s.dim}${ownership}${s.reset}`,
    `${s.dim}└${s.reset}`,
  ];
  return `${lines.join("\n")}\n`;
}
