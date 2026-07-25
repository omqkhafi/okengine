/**
 * Clack-inspired terminal styling for `oke` CLI / boot logs.
 *
 * Human TTY gets color + unicode chrome; CI / pipes stay plain.
 * Flip to monochrome with `NO_COLOR=1` or non-TTY stdout.
 */

/** Whether ANSI color should be applied. */
export function termColorEnabled(
  stream: { readonly isTTY?: boolean } = process.stdout,
): boolean {
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
  };
}

/**
 * `oke dev` intro — clack chrome; service URLs print as each surface binds.
 *
 * @param options - Color / watch hint
 */
export function formatDevBanner(
  options: { readonly color?: boolean; readonly watching?: boolean } = {},
): string {
  const s = termStyle(options.color ?? termColorEnabled());
  const bar = `${s.dim}│${s.reset}`;
  const lines = [
    "",
    `${s.cyan}${s.bold}┌${s.reset}  ${s.bold}oke dev${s.reset}`,
    bar,
    `${s.green}◇${s.reset}  Starting`,
  ];
  if (options.watching !== false) {
    lines.push(
      `${bar}  ${s.dim}watching — client types regenerate on save${s.reset}`,
    );
  }
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
 * App child ready line (`bun --hot` soft reload).
 *
 * @param url - App base URL
 * @param color - Color on/off
 */
export function formatAppReadyLine(
  url: string,
  color: boolean = termColorEnabled(),
): string {
  const s = termStyle(color);
  return `${s.green}●${s.reset}  ${s.dim}App${s.reset}      ${s.cyan}${url}${s.reset}\n`;
}

/**
 * Quiet status line (regen, stack up, …).
 *
 * @param message - Status text
 * @param color - Color on/off
 */
export function formatStatusLine(
  message: string,
  color: boolean = termColorEnabled(),
): string {
  const s = termStyle(color);
  return `${s.dim}│${s.reset}  ${s.dim}${message}${s.reset}\n`;
}

/**
 * First-admin claim code note (clack `note`-style box).
 *
 * @param code - Hex claim code
 * @param color - Color on/off
 */
export function formatClaimNote(
  code: string,
  color: boolean = termColorEnabled(),
): string {
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
