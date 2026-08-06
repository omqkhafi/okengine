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

/** One eight-element row in the hero. */
export type DevHeroElement = {
  readonly element: string;
  readonly detail: string;
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
    for (const row of elements) {
      const idle = row.detail === "—";
      const detail = idle ? `${s.dim}—${s.reset}` : `${s.cyan}${row.detail}${s.reset}`;
      lines.push(`${bar}  ${s.dim}${row.element.padEnd(9)}${s.reset} ${detail}`);
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
    `${s.green}◇${s.reset}  Starting`,
  ];
  if (options.watching !== false) {
    lines.push(`${bar}  ${s.dim}watching — client types regenerate on save${s.reset}`);
  }
  lines.push(formatDevHeroDetails(options).trimEnd());
  lines.push(bar);
  return `${lines.join("\n")}\n`;
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
 * Compact hero reprinted on soft reload — URLs stay, request logs do not.
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
 */
export function formatStatusLine(message: string, color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  return `${s.dim}│${s.reset}  ${s.dim}${message}${s.reset}\n`;
}

/** One infra service row for {@link formatStackSummary}. */
export type StackSummaryService = {
  /** Human label (`postgres`, `redis`). */
  readonly label: string;
  /** Published host port. */
  readonly hostPort: number;
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
 * `●  Backend GET  /health                 main.health            12ms  200  2026-07-26  03:11:42`
 *
 * @param options - Surface, method, path, flow, timing, status
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
    methodRaw === "GET"
      ? s.green
      : methodRaw === "POST"
        ? s.yellow
        : methodRaw === "PUT" || methodRaw === "PATCH"
          ? s.magenta
          : methodRaw === "DELETE"
            ? s.red
            : s.cyan;
  const method = methodRaw.padEnd(4);
  const path = options.path.length > 28 ? `${options.path.slice(0, 27)}…` : options.path.padEnd(28);
  const flow = (options.flow ?? "—").padEnd(22);
  const ms = `${options.ms}ms`.padStart(6);
  const main =
    `${surfaceColor}●${s.reset}  ` +
    `${surfaceColor}${options.surface.padEnd(7)}${s.reset}  ` +
    `${methodColor}${method}${s.reset} ` +
    `${s.cyan}${path}${s.reset}  ` +
    `${s.dim}${flow}${s.reset}  ` +
    `${s.dim}${ms}${s.reset}  ` +
    `${statusColor}${options.status}${s.reset}  ` +
    `${s.dim}${date}${s.reset}  ` +
    `${s.dim}${time}${s.reset}\n`;
  const detail = options.detail?.trim();
  if (!detail || options.status < 400) return main;
  const clipped = detail.length > 120 ? `${detail.slice(0, 119)}…` : detail;
  return `${main}${s.dim}   ↳ ${clipped}${s.reset}\n`;
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
  const lines: string[] = [
    `${s.green}◇${s.reset}  ${s.bold}Docker${s.reset}     ${s.cyan}${options.project}${s.reset}`,
  ];
  for (const svc of options.services) {
    lines.push(`${bar}  ${s.dim}${pad(svc.label)}${s.reset}  ${s.cyan}:${svc.hostPort}${s.reset}`);
  }
  const drivers = options.appDrivers ?? [];
  const appDetail = drivers.length > 0 ? `host Bun · ${drivers.join(" + ")}` : "host Bun";
  lines.push(`${bar}  ${s.dim}${pad("app")}${s.reset}  ${s.dim}${appDetail}${s.reset}`);
  lines.push(bar);
  return `${lines.join("\n")}\n`;
}

/**
 * First-admin claim code note (clack `note`-style box).
 *
 * @param code - Hex claim code
 * @param color - Color on/off
 */
export function formatClaimNote(code: string, color: boolean = termColorEnabled()): string {
  const s = termStyle(color);
  const bar = `${s.dim}│${s.reset}`;
  const title = "Claim code";
  const hint = "expires in 30 min";
  const ownership = "Whoever can read this log already owns the server.";
  const lines = [
    "",
    `${s.magenta}◆${s.reset}  ${s.bold}${title}${s.reset}  ${s.dim}${hint}${s.reset}`,
    bar,
    `${bar}  ${s.bold}${code}${s.reset}`,
    bar,
    `${bar}  ${s.dim}${ownership}${s.reset}`,
    `${s.dim}└${s.reset}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}
