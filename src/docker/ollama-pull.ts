/**
 * Pull an Ollama model via the container's HTTP API on its exposed host port.
 *
 * Never shells out to a host `ollama` CLI — that talks to whichever server wins
 * on the default local port (often a separately installed host daemon), so the
 * model can land outside the recipe container.
 *
 * Skips `/api/pull` when the model is already listed on `/api/tags`.
 */

/** Fetch contract (injectable for tests) — call signature only, not Bun's `preconnect`. */
export type OllamaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options for {@link ensureOllamaModel}. */
export interface EnsureOllamaModelOptions {
  /** Base URL of the container API, e.g. `http://127.0.0.1:11434`. */
  readonly url: string;
  /** Model tag to pull (e.g. `qwen3.5:9b`). */
  readonly model: string;
  readonly fetch?: OllamaFetch;
  /** How long to wait for `/api/tags` before giving up (ms). Default 90s. */
  readonly readyTimeoutMs?: number;
  /** Overall pull deadline (ms). Default 20 minutes. */
  readonly pullTimeoutMs?: number;
  /** Progress / status lines (e.g. `oke: …`). */
  readonly onStatus?: (line: string) => void;
}

/** Fail-loud pull / readiness error. */
export class OllamaPullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaPullError";
  }
}

/**
 * Normalize a base URL (trim trailing slash).
 *
 * @param url - Raw base URL
 */
export function normalizeOllamaPullUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Whether an installed tag covers the requested model id.
 *
 * @param want - Requested id (e.g. `gemma4:e4b`)
 * @param installed - Names from `/api/tags`
 */
export function ollamaTagsInclude(want: string, installed: readonly string[]): boolean {
  const id = want.trim();
  if (!id) return false;
  const base = id.split(":")[0] ?? id;
  return installed.some((name) => {
    if (name === id) return true;
    if (name.startsWith(`${id}-`)) return true;
    if (name.startsWith(`${base}:`) && id.startsWith(`${base}:`)) {
      const instTag = name.slice(base.length + 1);
      const wantTag = id.slice(base.length + 1);
      return (
        instTag === wantTag ||
        instTag.startsWith(`${wantTag}-`) ||
        wantTag.startsWith(instTag) ||
        (instTag === "latest" && wantTag === "latest")
      );
    }
    // bare name matches `name:latest`
    if (name === `${id}:latest` || id === `${name}:latest`) return true;
    return false;
  });
}

/**
 * Parse model names from an `/api/tags` JSON body.
 *
 * @param json - Parsed response
 */
export function parseOllamaTagsNames(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const models = (json as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((m) =>
      m && typeof m === "object" && typeof (m as { name?: unknown }).name === "string"
        ? (m as { name: string }).name
        : null,
    )
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

/**
 * Wait until `GET /api/tags` succeeds; skip pull when the model is already
 * present; otherwise `POST /api/pull` with streaming progress.
 *
 * @param opts - Target URL + model (+ optional injectable fetch)
 */
export async function ensureOllamaModel(opts: EnsureOllamaModelOptions): Promise<void> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const base = normalizeOllamaPullUrl(opts.url);
  const model = opts.model.trim();
  const status = opts.onStatus ?? (() => {});
  if (!model) throw new OllamaPullError("ollama pull: model id is empty");

  const readyDeadline = Date.now() + (opts.readyTimeoutMs ?? 90_000);
  let tagsBody: unknown = null;
  while (Date.now() < readyDeadline) {
    try {
      const res = await fetchFn(`${base}/api/tags`, { method: "GET" });
      if (res.ok) {
        tagsBody = await res.json().catch(() => null);
        break;
      }
    } catch {
      // still starting
    }
    await Bun.sleep(500);
  }
  if (tagsBody === null) {
    throw new OllamaPullError(`ollama pull: unreachable at ${base}/api/tags`);
  }

  const installed = parseOllamaTagsNames(tagsBody);
  if (ollamaTagsInclude(model, installed)) {
    status(`oke: Ollama already has ${model} at ${base} — skip pull`);
    return;
  }

  status(`oke: pulling ${model} into Ollama at ${base}…`);

  const pullDeadline = Date.now() + (opts.pullTimeoutMs ?? 20 * 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, pullDeadline - Date.now()));
  try {
    const res = await fetchFn(`${base}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OllamaPullError(
        `ollama pull: POST ${base}/api/pull → ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
      );
    }
    await consumeOllamaPullStream(res, status);
  } catch (err) {
    if (err instanceof OllamaPullError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new OllamaPullError(`ollama pull: POST ${base}/api/pull failed — ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read NDJSON pull progress; surface concise status updates.
 *
 * @param res - Streaming pull response
 * @param status - Status writer
 */
async function consumeOllamaPullStream(
  res: Response,
  status: (line: string) => void,
): Promise<void> {
  // Non-body responses (mocked tests) — treat as complete.
  if (!res.body) {
    await res.arrayBuffer().catch(() => undefined);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const state: PullStreamState = { lastStatus: "", lastPct: -1 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      handlePullLine(line, status, state);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) {
    handlePullLine(buf, status, state);
  }
}

type PullStreamState = { lastStatus: string; lastPct: number };

function handlePullLine(
  line: string,
  status: (line: string) => void,
  state: PullStreamState,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let row: {
    status?: string;
    error?: string;
    completed?: number;
    total?: number;
  };
  try {
    row = JSON.parse(trimmed) as typeof row;
  } catch {
    return;
  }
  if (row.error) {
    throw new OllamaPullError(`ollama pull: ${row.error}`);
  }
  const st = row.status?.trim() ?? "";
  if (typeof row.completed === "number" && typeof row.total === "number" && row.total > 0) {
    const pct = Math.min(100, Math.floor((100 * row.completed) / row.total));
    if (pct !== state.lastPct && (pct === 100 || pct - state.lastPct >= 5)) {
      state.lastPct = pct;
      status(`oke: Ollama pull ${pct}%${st ? ` (${st})` : ""}`);
    }
    return;
  }
  if (st && st !== state.lastStatus) {
    state.lastStatus = st;
    if (/^pulling\s+[a-f0-9]{12}/i.test(st)) return;
    status(`oke: Ollama ${st}`);
  }
}
