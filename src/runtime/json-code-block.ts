/**
 * Browser GET → traces-language JSON page. Clients still get the envelope.
 */

import { CONSOLE_PORT } from "./types.ts";

/** One highlighted JSON span. */
export type JsonCodeTokenKind = "key" | "string" | "number" | "literal" | "punct" | "space";

/** Highlighted span. */
export interface JsonCodeToken {
  readonly kind: JsonCodeTokenKind;
  readonly text: string;
}

/** Inputs for {@link renderJsonCodeBlockHtml}. */
export interface JsonCodeBlockRenderOptions {
  readonly json: string;
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly app: string;
  readonly consoleUrl: string;
  readonly rawHref: string;
  readonly prettyHref: string;
  /** Compact one-line JSON (`?raw=1`). Default pretty. */
  readonly compact?: boolean;
  /** Route tree for the right-rail nav (Schema panel language). */
  readonly nav?: readonly JsonCodeNavGroup[];
  /** Handler elapsed time in milliseconds. */
  readonly latencyMs?: number;
  /** Wide-event cache dimension from the invocation. */
  readonly cache?: JsonCodeCache;
}

/** Wide-event cache dimension on the browser JSON page. */
export type JsonCodeCache = "hit" | "miss" | "none";

/** One HTTP route under a {@link JsonCodeNavGroup}. */
export interface JsonCodeNavRoute {
  readonly method: string;
  readonly path: string;
  /** Set for static GET — other verbs / params are listed only. */
  readonly href: string | null;
  readonly current: boolean;
}

/** First-segment group in the Routes rail. */
export interface JsonCodeNavGroup {
  readonly name: string;
  readonly routes: readonly JsonCodeNavRoute[];
}

/** Binding-shaped input for {@link httpGetNavPaths} and {@link httpNavGroups}. */
export interface HttpGetNavSource {
  readonly trigger: {
    readonly kind: string;
    readonly method?: string;
    readonly path?: string;
  };
}

const HTML_ESCAPE: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Escape text for an HTML text node or attribute.
 *
 * @param value - Raw text
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

/**
 * Pretty-print JSON when the body is valid; otherwise return the raw text.
 *
 * @param raw - Response body
 */
export function prettyJson(raw: string): string {
  return formatJson(raw, false);
}

/**
 * Compact or pretty JSON when the body is valid; otherwise the raw text.
 *
 * @param raw - Response body
 * @param compact - One line when true
 */
export function formatJson(raw: string, compact: boolean): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, compact ? undefined : 2);
  } catch {
    return raw;
  }
}

/**
 * Tokenize JSON for the code-block highlighter.
 *
 * @param source - Pretty-printed JSON (or raw text)
 */
export function tokenizeJson(source: string): JsonCodeToken[] {
  const tokens: JsonCodeToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      let end = i + 1;
      while (end < source.length) {
        const next = source[end]!;
        if (next !== " " && next !== "\t" && next !== "\n" && next !== "\r") break;
        end += 1;
      }
      tokens.push({ kind: "space", text: source.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === ":" || ch === ",") {
      tokens.push({ kind: "punct", text: ch });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const end = scanJsonString(source, i);
      tokens.push({ kind: "string", text: source.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const end = scanJsonNumber(source, i);
      tokens.push({ kind: "number", text: source.slice(i, end) });
      i = end;
      continue;
    }
    if (source.startsWith("true", i) && !isJsonIdent(source[i + 4])) {
      tokens.push({ kind: "literal", text: "true" });
      i += 4;
      continue;
    }
    if (source.startsWith("false", i) && !isJsonIdent(source[i + 5])) {
      tokens.push({ kind: "literal", text: "false" });
      i += 5;
      continue;
    }
    if (source.startsWith("null", i) && !isJsonIdent(source[i + 4])) {
      tokens.push({ kind: "literal", text: "null" });
      i += 4;
      continue;
    }
    tokens.push({ kind: "space", text: ch });
    i += 1;
  }
  return markJsonKeys(tokens);
}

/**
 * Best q-value for `type/subtype` in an Accept header (star ranges count).
 *
 * @param accept - Raw Accept header
 * @param type - Type (`text`, `application`)
 * @param subtype - Subtype (`html`, `json`)
 */
export function acceptQuality(accept: string, type: string, subtype: string): number {
  let best = 0;
  let found = false;
  for (const part of accept.split(",")) {
    const [rangeRaw, ...params] = part.split(";").map((s) => s.trim());
    const range = rangeRaw?.toLowerCase();
    if (!range) continue;
    let q = 1;
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;
      if (param.slice(0, eq).trim().toLowerCase() !== "q") continue;
      const parsed = Number(param.slice(eq + 1).trim());
      if (Number.isFinite(parsed)) q = parsed;
    }
    if (q < 0) q = 0;
    if (q > 1) q = 1;
    const [rType, rSub] = range.split("/");
    if (!rType || !rSub) continue;
    const exact = rType === type && rSub === subtype;
    const typeStar = rType === type && rSub === "*";
    const star = rType === "*" && rSub === "*";
    if (!exact && !typeStar && !star) continue;
    if (!found || q > best) best = q;
    found = true;
  }
  return found ? best : 0;
}

/**
 * True when `text/html` outranks `application/json` (browsers). Ties stay JSON.
 *
 * @param accept - Raw Accept header
 */
export function prefersHtml(accept: string | null): boolean {
  if (!accept?.trim()) return false;
  return acceptQuality(accept, "text", "html") > acceptQuality(accept, "application", "json");
}

/**
 * Whether this GET JSON response should become the browser code block.
 *
 * @param request - Incoming request
 * @param response - Encoded JSON envelope
 */
export function shouldRenderJsonCodeBlock(request: Request, response: Response): boolean {
  if (request.method.toUpperCase() !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname === "/_/ready" || url.pathname.startsWith("/_/")) return false;
  if (url.pathname.startsWith("/_oke/")) return false;
  if (url.searchParams.get("format") === "json") return false;
  if (!prefersHtml(request.headers.get("accept"))) return false;
  const ct = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return ct === "application/json";
}

/**
 * Console URL on the same host as the app request.
 *
 * @param request - Incoming request
 */
export function consoleUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  const host = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  return `${url.protocol}//${host}:${CONSOLE_PORT}`;
}

/**
 * `?raw=1` href that keeps other query params.
 *
 * @param request - Incoming request
 */
export function rawHrefFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.set("raw", "1");
  return `${url.pathname}${url.search}`;
}

/**
 * Pretty-view href — drops `raw`, keeps other query params.
 *
 * @param request - Incoming request
 */
export function prettyHrefFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.delete("raw");
  const search = url.searchParams.toString();
  return search.length > 0 ? `${url.pathname}?${search}` : url.pathname;
}

/**
 * Static GET paths from HTTP bindings — no params, no `/_/` internals.
 *
 * @param bindings - Adopted app bindings
 */
export function httpGetNavPaths(bindings: readonly HttpGetNavSource[]): string[] {
  const paths = new Set<string>();
  for (const binding of bindings) {
    const trigger = binding.trigger;
    if (trigger.kind !== "http" || trigger.method !== "GET") continue;
    const path = trigger.path;
    if (!path || path.includes(":") || path.startsWith("/_/")) continue;
    paths.add(path);
  }
  return [...paths].sort(compareNavPath);
}

/**
 * Group HTTP routes by first path segment for the Routes rail.
 *
 * @param bindings - Adopted app bindings
 * @param request - Incoming request
 */
export function httpNavGroups(
  bindings: readonly HttpGetNavSource[],
  request: Request,
): JsonCodeNavGroup[] {
  const url = new URL(request.url);
  const raw = url.searchParams.has("raw");
  const byGroup = new Map<string, Map<string, JsonCodeNavRoute>>();
  for (const binding of bindings) {
    const trigger = binding.trigger;
    if (trigger.kind !== "http") continue;
    const method = trigger.method;
    const path = trigger.path;
    if (!method || !path || path.startsWith("/_/")) continue;
    const name = navGroupName(path);
    const key = `${method} ${path}`;
    const navigable = method === "GET" && !path.includes(":");
    const group = byGroup.get(name) ?? new Map<string, JsonCodeNavRoute>();
    group.set(key, {
      method,
      path,
      href: navigable ? (raw ? `${path}?raw=1` : path) : null,
      current: method === "GET" && url.pathname === path,
    });
    byGroup.set(name, group);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => compareNavPath(a === "/" ? "/" : `/${a}`, b === "/" ? "/" : `/${b}`))
    .map(([name, routes]) => ({
      name,
      routes: [...routes.values()].sort((left, right) => {
        const pathCmp = compareNavPath(left.path, right.path);
        return pathCmp !== 0 ? pathCmp : left.method.localeCompare(right.method);
      }),
    }));
}

function navGroupName(path: string): string {
  if (path === "/") return "/";
  return path.split("/").filter((seg) => seg.length > 0)[0] ?? "/";
}

function compareNavPath(a: string, b: string): number {
  if (a === "/") return -1;
  if (b === "/") return 1;
  return a.localeCompare(b);
}

/**
 * Compact latency for the browser JSON page header.
 *
 * @param ms - Elapsed milliseconds
 */
export function formatJsonCodeLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0μs";
  if (ms < 1) return `${Math.round(ms * 1_000)}μs`;
  if (ms < 1_000) {
    const rounded = Math.round(ms * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}ms` : `${rounded.toFixed(1)}ms`;
  }
  const seconds = ms / 1_000;
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

/** Traces duration bands — same cutoffs as Console TraceRow. */
export type JsonCodeLatencyTone =
  | "fast"
  | "good"
  | "ok"
  | "elevated"
  | "warn"
  | "slow"
  | "bad"
  | "critical";

const LATENCY_TONE_BOUNDS = [
  { tone: "fast", belowMs: 10 },
  { tone: "good", belowMs: 50 },
  { tone: "ok", belowMs: 100 },
  { tone: "elevated", belowMs: 250 },
  { tone: "warn", belowMs: 500 },
  { tone: "slow", belowMs: 1_000 },
  { tone: "bad", belowMs: 5_000 },
] as const;

/**
 * Cool→hot latency tone — same bands as Console traces.
 *
 * @param ms - Elapsed milliseconds
 */
export function jsonCodeLatencyTone(ms: number): JsonCodeLatencyTone {
  if (!Number.isFinite(ms) || ms < 0) return "fast";
  for (const band of LATENCY_TONE_BOUNDS) {
    if (ms < band.belowMs) return band.tone;
  }
  return "critical";
}

/**
 * Full-bleed traces-language page for one JSON envelope.
 *
 * @param options - Envelope + chrome
 */
export function renderJsonCodeBlockHtml(options: JsonCodeBlockRenderOptions): string {
  const compact = options.compact === true;
  const code = formatJson(options.json, compact);
  const tokens = tokenizeJson(code);
  const lines = splitTokenLines(tokens);
  const title = `${options.method} ${options.path}`;
  const ok = options.status >= 200 && options.status < 300;
  const rows = lines
    .map((line, index) => {
      const n = index + 1;
      const inner = line.length === 0 ? " " : line.map(tokenHtml).join("");
      return `<span class="ln"><span class="n">${n}</span><span class="c${compact ? " wrap" : ""}">${inner}</span></span>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(title)} · ${escapeHtml(options.app)}</title>
<style>
:root {
  --field: oklch(0.141 0.005 285.823);
  --ink: oklch(0.985 0 0);
  --mute: oklch(0.705 0.015 286.067);
  --line: oklch(1 0 0 / 0.06);
  --hover: oklch(0.25 0.006 286.033 / 0.5);
  --ready: oklch(0.75 0.14 163);
  --fail: oklch(0.7 0.19 22);
  --key: oklch(0.78 0.1 230);
  --str: oklch(0.82 0.05 55);
  --num: oklch(0.8 0.04 80);
  --lit: oklch(0.78 0.09 250);
  --punct: oklch(0.78 0 0);
}
@media (prefers-color-scheme: light) {
  :root {
    --field: oklch(1 0 0);
    --ink: oklch(0.141 0.005 285.823);
    --mute: oklch(0.552 0.016 285.938);
    --line: oklch(0.141 0.005 285.823 / 0.12);
    --hover: oklch(0.967 0.001 286.375 / 0.7);
    --ready: oklch(0.55 0.14 163);
    --fail: oklch(0.58 0.22 25);
    --key: oklch(0.5 0.12 230);
    --str: oklch(0.5 0.1 45);
    --num: oklch(0.48 0.08 80);
    --lit: oklch(0.45 0.14 250);
    --punct: oklch(0.35 0 0);
  }
  .lat-fast { color: oklch(0.696 0.17 162.48); }
  .lat-good { color: oklch(0.596 0.145 163.225); }
  .lat-ok { color: oklch(0.648 0.2 131.684); }
  .lat-elevated { color: oklch(0.681 0.162 75.834); }
  .lat-warn { color: oklch(0.666 0.179 58.318); }
  .lat-slow { color: oklch(0.646 0.222 41.116); }
  .lat-critical { color: oklch(0.514 0.222 16.935); }
  .cache-hit { color: oklch(0.685 0.169 237.323); }
  .cache-miss { color: oklch(0.666 0.179 58.318); }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  height: 100svh;
  max-height: 100svh;
  overflow: hidden;
  background: var(--field);
  color: var(--ink);
}
body {
  display: flex;
  flex-direction: column;
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
}
.page { display: flex; flex-direction: column; height: 100%; }
.strip {
  display: flex;
  align-items: stretch;
  height: 2.5rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
}
.title {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: .875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.count {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--mute);
}
.lat-fast { color: oklch(0.765 0.177 163.223); }
.lat-good { color: oklch(0.845 0.143 164.978); }
.lat-ok { color: oklch(0.841 0.238 128.85); }
.lat-elevated { color: oklch(0.852 0.199 91.936); }
.lat-warn { color: oklch(0.828 0.189 84.429); }
.lat-slow { color: oklch(0.75 0.183 55.934); }
.lat-bad { color: var(--fail); }
.lat-critical { color: oklch(0.712 0.194 13.428); }
.cache { gap: .25rem; }
.cache-hit { color: oklch(0.746 0.16 232.661); }
.cache-miss { color: oklch(0.828 0.189 84.429); }
.cache-none { color: color-mix(in oklab, var(--mute) 40%, transparent); }
.grow { flex: 1; min-width: 0; }
.token {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: .08em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--mute);
}
.token:hover { background: var(--hover); color: var(--ink); }
.token.is-on { color: var(--ink); }
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  color: var(--mute);
}
.file {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  padding-right: .5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.head {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mute);
}
.state {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: ${ok ? "var(--ready)" : "var(--fail)"};
}
.copy {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--mute);
  min-width: 2rem;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  cursor: pointer;
}
.copy:hover { background: var(--hover); color: var(--ink); }
.copy:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.body { display: flex; flex: 1; min-height: 0; }
.view { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.rail-check { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rail {
  display: flex;
  width: 14rem;
  flex-shrink: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--line);
}
.rail-head { justify-content: space-between; padding: 0 .5rem; }
.rail-head .head { padding: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rail-list { flex: 1; min-height: 0; margin: 0; padding: 0; overflow: auto; list-style: none; }
.band {
  display: flex;
  align-items: center;
  gap: .25rem;
  width: 100%;
  padding: .375rem .5rem .375rem .25rem;
  cursor: pointer;
  list-style: none;
}
.band::-webkit-details-marker { display: none; }
.band:hover { background: var(--hover); }
.chev {
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  color: var(--mute);
}
details:not([open]) .chev { transform: rotate(-90deg); }
.band-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ink);
}
.cols {
  margin: 0 0 0 .75rem;
  padding: 0;
  list-style: none;
  border-left: 1px solid var(--line);
}
.leaf {
  position: relative;
  display: flex;
  align-items: center;
  gap: .375rem;
  width: 100%;
  padding: .25rem .5rem;
  text-decoration: none;
  color: var(--mute);
}
.leaf:hover { background: var(--hover); color: var(--ink); }
.leaf.is-on { background: oklch(0.25 0.006 286.033 / 0.7); color: var(--ink); }
.leaf.is-on::before {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: oklch(0.685 0.148 237);
}
.leaf-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.leaf-type {
  margin-left: auto;
  flex-shrink: 0;
  font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--mute) 70%, transparent);
}
.rail-thin {
  display: none;
  width: 1.75rem;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  gap: .5rem;
  padding: .5rem 0;
  border-left: 1px solid var(--line);
  color: var(--mute);
  text-decoration: none;
  cursor: pointer;
}
.rail-thin:hover { background: var(--hover); color: var(--ink); }
.rail-thin span {
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .08em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
}
.rail-check:not(:checked) ~ .rail { display: none; }
.rail-check:not(:checked) ~ .rail-thin { display: flex; }
@media (prefers-color-scheme: light) {
  .leaf.is-on { background: oklch(0.967 0.001 286.375 / 0.7); }
}
pre {
  margin: 0;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ln {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr);
  min-height: 1.35rem;
}
.ln:hover { background: var(--hover); }
.n {
  user-select: none;
  padding-right: .75rem;
  text-align: right;
  color: color-mix(in oklab, var(--mute) 70%, transparent);
  font-variant-numeric: tabular-nums;
  border-right: 1px solid var(--line);
}
.c { padding: 0 1rem 0 .5rem; white-space: pre; }
.c.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.k { color: var(--key); }
.s { color: var(--str); }
.m { color: var(--num); }
.l { color: var(--lit); }
.p { color: var(--punct); }
</style>
</head>
<body>
  <main class="page" data-slot="json-code-block" data-state="complete" data-view="${compact ? "raw" : "pretty"}">
    <header class="strip">
      <span class="title">${escapeHtml(options.app)}</span>
      <span class="count">${options.status}</span>
      ${latencyHtml(options.latencyMs)}
      ${cacheHtml(options.cache)}
      <span class="grow"></span>
      <a class="token" href="${escapeHtml(options.consoleUrl)}">Console</a>
      <a class="token${compact ? "" : " is-on"}" href="${escapeHtml(options.prettyHref)}">Pretty</a>
      <a class="token${compact ? " is-on" : ""}" href="${escapeHtml(options.rawHref)}">Raw</a>
    </header>
    <header class="strip">
      <span class="icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7.2L19 8.2V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20V3.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 3.5V8h5" stroke="currentColor" stroke-width="1.5"/></svg>
      </span>
      <span class="file">${escapeHtml(title)}</span>
      <span class="head">json</span>
      <span class="state">${ok ? "Ready" : options.status}</span>
      <button class="copy" type="button" aria-label="Copy code" title="Copy code">
        <svg data-copy width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H16" stroke="currentColor" stroke-width="1.5"/></svg>
        <svg data-done hidden width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </header>
    <div class="body">
      <div class="view"><pre>${rows}</pre></div>
      ${navHtml(options.nav)}
    </div>
  </main>
  <textarea id="payload" hidden>${escapeHtml(code)}</textarea>
  <script>
  (() => {
    const btn = document.querySelector(".copy");
    const payload = document.getElementById("payload");
    const copyIcon = btn?.querySelector("[data-copy]");
    const doneIcon = btn?.querySelector("[data-done]");
    if (!btn || !payload) return;
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(payload.value); } catch { payload.select(); document.execCommand("copy"); }
      btn.setAttribute("aria-label", "Copied");
      btn.title = "Copied";
      if (copyIcon) copyIcon.hidden = true;
      if (doneIcon) doneIcon.hidden = false;
      setTimeout(() => {
        btn.setAttribute("aria-label", "Copy code");
        btn.title = "Copy code";
        if (copyIcon) copyIcon.hidden = false;
        if (doneIcon) doneIcon.hidden = true;
      }, 1600);
    });
  })();
  </script>
</body>
</html>
`;
}

/**
 * Wrap a JSON GET response in the browser code-block page when Accept prefers HTML.
 *
 * @param request - Incoming request
 * @param response - Encoded envelope
 * @param app - Manifest app name
 * @param nav - Route groups for the right-rail tree
 * @param latencyMs - Handler elapsed time
 * @param cache - Wide-event cache dimension
 */
export async function asBrowserJsonCodeBlock(
  request: Request,
  response: Response,
  app: string,
  nav: readonly JsonCodeNavGroup[] = [],
  latencyMs?: number,
  cache: JsonCodeCache = "none",
): Promise<Response> {
  if (!shouldRenderJsonCodeBlock(request, response)) return response;
  const json = await response.text();
  const url = new URL(request.url);
  const html = renderJsonCodeBlockHtml({
    json,
    status: response.status,
    method: request.method.toUpperCase(),
    path: url.pathname,
    app,
    consoleUrl: consoleUrlFromRequest(request),
    rawHref: rawHrefFromRequest(request),
    prettyHref: prettyHrefFromRequest(request),
    compact: url.searchParams.has("raw"),
    nav,
    latencyMs,
    cache,
  });
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Accept");
  else if (!/\baccept\b/i.test(vary)) headers.set("vary", `${vary}, Accept`);
  return new Response(html, { status: response.status, headers });
}

function latencyHtml(ms: number | undefined): string {
  if (ms === undefined) return "";
  const tone = jsonCodeLatencyTone(ms);
  const label = formatJsonCodeLatency(ms);
  return `<span class="count lat-${tone}" data-slot="json-code-latency" data-tone="${tone}" title="Latency">${escapeHtml(label)}</span>`;
}

const CACHE_MARK: Readonly<
  Record<JsonCodeCache, { readonly title: string; readonly text: string; readonly icon: string }>
> = {
  hit: {
    title: "Cache hit",
    text: "Hit",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  },
  miss: {
    title: "Cache miss",
    text: "Miss",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  },
  none: {
    title: "Cache not applicable",
    text: "None",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 17 17 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
};

function cacheHtml(cache: JsonCodeCache | undefined): string {
  const mark = CACHE_MARK[cache ?? "none"];
  return `<span class="count cache cache-${cache ?? "none"}" data-slot="json-code-cache" data-cache="${cache ?? "none"}" title="${mark.title}">${mark.icon}${escapeHtml(mark.text)}</span>`;
}

function navHtml(nav: readonly JsonCodeNavGroup[] | undefined): string {
  if (!nav || nav.length === 0) return "";
  const groups = nav.map(navGroupHtml).join("");
  return `<input class="rail-check" type="checkbox" id="json-code-rail">
<aside class="rail" data-slot="json-code-nav-panel" aria-label="Routes">
  <header class="strip rail-head">
    <p class="head">Routes</p>
    <label class="copy" for="json-code-rail" aria-label="Collapse routes" title="Collapse routes">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </label>
  </header>
  <ul class="rail-list">${groups}</ul>
</aside>
<label class="rail-thin" for="json-code-rail" aria-label="Expand routes" title="Expand routes">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5.5 8.5 12 15 18.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <span>Routes</span>
</label>`;
}

function navGroupHtml(group: JsonCodeNavGroup): string {
  const leaves = group.routes.map(navRouteHtml).join("");
  const open = group.routes.some((route) => route.current) ? " open" : "";
  return `<li>
    <details${open}>
      <summary class="band">
        <span class="chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="band-name">${escapeHtml(group.name)}</span>
      </summary>
      <ul class="cols">${leaves}</ul>
    </details>
  </li>`;
}

function navRouteHtml(route: JsonCodeNavRoute): string {
  const on = route.current ? " is-on" : "";
  const inner = `<span class="leaf-path">${escapeHtml(route.path)}</span><span class="leaf-type">${escapeHtml(route.method)}</span>`;
  if (route.href) {
    return `<li><a class="leaf${on}" href="${escapeHtml(route.href)}">${inner}</a></li>`;
  }
  return `<li><span class="leaf${on}">${inner}</span></li>`;
}

function isJsonIdent(ch: string | undefined): boolean {
  if (!ch) return false;
  return (
    (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_"
  );
}

function scanJsonString(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  return source.length;
}

function scanJsonNumber(source: string, start: number): number {
  let i = start;
  if (source[i] === "-") i += 1;
  while (i < source.length && source[i]! >= "0" && source[i]! <= "9") i += 1;
  if (source[i] === ".") {
    i += 1;
    while (i < source.length && source[i]! >= "0" && source[i]! <= "9") i += 1;
  }
  const exp = source[i];
  if (exp === "e" || exp === "E") {
    i += 1;
    if (source[i] === "+" || source[i] === "-") i += 1;
    while (i < source.length && source[i]! >= "0" && source[i]! <= "9") i += 1;
  }
  return i;
}

function markJsonKeys(tokens: readonly JsonCodeToken[]): JsonCodeToken[] {
  const out: JsonCodeToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind !== "string") {
      out.push(token);
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && tokens[j]?.kind === "space") j += 1;
    out.push(
      tokens[j]?.kind === "punct" && tokens[j]?.text === ":"
        ? { kind: "key", text: token.text }
        : token,
    );
  }
  return out;
}

function splitTokenLines(tokens: readonly JsonCodeToken[]): JsonCodeToken[][] {
  const lines: JsonCodeToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind !== "space" || !token.text.includes("\n")) {
      lines[lines.length - 1]!.push(token);
      continue;
    }
    const parts = token.text.split("\n");
    for (let p = 0; p < parts.length; p += 1) {
      const piece = parts[p]!;
      if (piece.length > 0) lines[lines.length - 1]!.push({ kind: "space", text: piece });
      if (p < parts.length - 1) lines.push([]);
    }
  }
  return lines;
}

function tokenHtml(token: JsonCodeToken): string {
  const text = escapeHtml(token.text);
  switch (token.kind) {
    case "key":
      return `<span class="k">${text}</span>`;
    case "string":
      return `<span class="s">${text}</span>`;
    case "number":
      return `<span class="m">${text}</span>`;
    case "literal":
      return `<span class="l">${text}</span>`;
    case "punct":
      return `<span class="p">${text}</span>`;
    default:
      return text;
  }
}
