/**
 * Pull an Ollama model via the container's HTTP API on its exposed host port.
 *
 * Never shells out to a host `ollama` CLI — that talks to whichever server wins
 * on the default local port (often a separately installed host daemon), so the
 * model can land outside the recipe container.
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
 * Wait until `GET /api/tags` succeeds, then `POST /api/pull` for `model`.
 *
 * @param opts - Target URL + model (+ optional injectable fetch)
 */
export async function ensureOllamaModel(opts: EnsureOllamaModelOptions): Promise<void> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const base = normalizeOllamaPullUrl(opts.url);
  const model = opts.model.trim();
  if (!model) throw new OllamaPullError("ollama pull: model id is empty");

  const readyDeadline = Date.now() + (opts.readyTimeoutMs ?? 90_000);
  let ready = false;
  while (Date.now() < readyDeadline) {
    try {
      const res = await fetchFn(`${base}/api/tags`, { method: "GET" });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // still starting
    }
    await Bun.sleep(500);
  }
  if (!ready) {
    throw new OllamaPullError(`ollama pull: unreachable at ${base}/api/tags`);
  }

  const pullDeadline = Date.now() + (opts.pullTimeoutMs ?? 20 * 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, pullDeadline - Date.now()));
  try {
    const res = await fetchFn(`${base}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OllamaPullError(
        `ollama pull: POST ${base}/api/pull → ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
      );
    }
    // Non-streaming response is a single JSON object; streaming would be NDJSON.
    // Consume the body so the connection completes even if the server streams.
    await res.arrayBuffer();
  } catch (err) {
    if (err instanceof OllamaPullError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new OllamaPullError(`ollama pull: POST ${base}/api/pull failed — ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
