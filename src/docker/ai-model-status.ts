/**
 * Probe local AI servers for configured-model readiness (llama.cpp / Ollama /
 * OpenAI-compatible). Used by `oke dev` to show model id + phase without
 * blocking boot.
 */

/** Normalized readiness phase for a configured model. */
export type AiModelPhase = "unreachable" | "starting" | "loading" | "ready" | "error";

/** Snapshot of one model’s readiness. */
export type AiModelStatus = {
  /** Requested model id (`OKE_AI_MODEL`). */
  readonly model: string;
  readonly phase: AiModelPhase;
  /** Optional short detail (error text, reported id). */
  readonly detail?: string;
  /** Id reported by the server when it differs from {@link model}. */
  readonly reportedId?: string;
};

/** Which HTTP surface to probe. */
export type AiModelProbeKind = "openai-compatible" | "ollama";

/** Fetch contract (injectable for tests). */
export type AiModelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options for {@link probeAiModelStatus}. */
export type ProbeAiModelStatusOptions = {
  /** Base URL — with or without trailing `/v1` for OpenAI-compatible. */
  readonly url: string;
  readonly model: string;
  readonly kind: AiModelProbeKind;
  readonly fetch?: AiModelFetch;
};

/**
 * Strip trailing slashes; for OpenAI-compatible keep a single `/v1` suffix.
 *
 * @param url - Raw base URL
 * @param kind - Probe kind
 */
export function normalizeAiProbeUrl(url: string, kind: AiModelProbeKind): string {
  let base = url.trim().replace(/\/+$/, "");
  if (kind === "openai-compatible") {
    if (!base.endsWith("/v1")) base = `${base}/v1`;
  } else if (base.endsWith("/v1")) {
    base = base.slice(0, -3);
  }
  return base;
}

/**
 * Whether a reported model id covers the requested `OKE_AI_MODEL`.
 *
 * Tolerates llama.cpp alias normalization (`gemma4:e4b-q4_K_M` ↔ `gemma4:Q4_K_M`).
 *
 * @param want - Requested id
 * @param reported - Server id
 */
export function aiModelIdsMatch(want: string, reported: string): boolean {
  const a = want.trim();
  const b = reported.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return true;
  const aBase = aLower.split(":")[0] ?? aLower;
  const bBase = bLower.split(":")[0] ?? bLower;
  if (aBase !== bBase) return false;
  const aTag = aLower.slice(aBase.length + 1);
  const bTag = bLower.slice(bBase.length + 1);
  if (!aTag || !bTag) return true;
  if (aTag === bTag) return true;
  // Quant suffixes: e4b-q4_k_m vs q4_k_m
  if (aTag.endsWith(bTag) || bTag.endsWith(aTag)) return true;
  const norm = (t: string) => t.replace(/[^a-z0-9]/g, "");
  return norm(aTag).includes(norm(bTag)) || norm(bTag).includes(norm(aTag));
}

/**
 * Parse OpenAI-compatible `GET /v1/models` body into a status for `model`.
 *
 * @param model - Requested id
 * @param json - Parsed JSON
 */
export function statusFromOpenAiModels(model: string, json: unknown): AiModelStatus {
  if (!json || typeof json !== "object") {
    return { model, phase: "starting", detail: "invalid /v1/models body" };
  }
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return { model, phase: "starting", detail: "no model list" };
  }
  if (data.length === 0) {
    return { model, phase: "starting", detail: "no models registered yet" };
  }
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string" || !aiModelIdsMatch(model, id)) continue;
    const status = (row as { status?: unknown }).status;
    const value =
      typeof status === "string"
        ? status
        : status &&
            typeof status === "object" &&
            typeof (status as { value?: unknown }).value === "string"
          ? (status as { value: string }).value
          : undefined;
    const phase = mapServerPhase(value);
    return {
      model,
      phase,
      reportedId: id,
      ...(phase === "error" && value ? { detail: value } : {}),
    };
  }
  return {
    model,
    phase: "starting",
    detail: `waiting for ${model} (server has ${data.length} other model(s))`,
  };
}

/**
 * Parse Ollama `GET /api/tags` into a status for `model`.
 *
 * @param model - Requested id
 * @param json - Parsed JSON
 */
export function statusFromOllamaTags(model: string, json: unknown): AiModelStatus {
  if (!json || typeof json !== "object") {
    return { model, phase: "starting", detail: "invalid /api/tags body" };
  }
  const models = (json as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    return { model, phase: "starting" };
  }
  for (const row of models) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name === "string" && aiModelIdsMatch(model, name)) {
      return { model, phase: "ready", reportedId: name };
    }
  }
  return { model, phase: "loading", detail: "not in /api/tags yet" };
}

/**
 * Map a server-native status string to {@link AiModelPhase}.
 *
 * @param value - Raw status
 */
function mapServerPhase(value: string | undefined): AiModelPhase {
  if (!value) return "ready";
  const v = value.trim().toLowerCase();
  if (v === "ready" || v === "running" || v === "loaded" || v === "idle") return "ready";
  if (v === "loading" || v === "pulling" || v === "downloading" || v === "starting") {
    return v === "starting" ? "starting" : "loading";
  }
  if (v === "error" || v === "failed" || v === "unhealthy") return "error";
  return "loading";
}

/**
 * Probe the AI HTTP API once.
 *
 * @param opts - URL + model + kind
 */
export async function probeAiModelStatus(opts: ProbeAiModelStatusOptions): Promise<AiModelStatus> {
  const model = opts.model.trim();
  if (!model) return { model: "", phase: "error", detail: "OKE_AI_MODEL is empty" };
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const base = normalizeAiProbeUrl(opts.url, opts.kind);
  const path = opts.kind === "ollama" ? `${base}/api/tags` : `${base}/models`;
  try {
    const res = await fetchFn(path, { method: "GET" });
    if (!res.ok) {
      return {
        model,
        phase: res.status >= 500 ? "starting" : "error",
        detail: `HTTP ${res.status}`,
      };
    }
    const json: unknown = await res.json().catch(() => null);
    return opts.kind === "ollama"
      ? statusFromOllamaTags(model, json)
      : statusFromOpenAiModels(model, json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { model, phase: "unreachable", detail: msg };
  }
}

/**
 * One-line status for `oke dev` logs.
 *
 * @param status - Probe result
 */
export function formatAiModelStatusMessage(status: AiModelStatus): string {
  const id =
    status.reportedId && status.reportedId !== status.model
      ? `${status.model} (${status.reportedId})`
      : status.model || "(unset)";
  switch (status.phase) {
    case "unreachable":
      return `AI ${id} — waiting for server…`;
    case "starting":
      return `AI ${id} — starting…`;
    case "loading":
      return `AI ${id} — loading…`;
    case "ready":
      return `AI ${id} — ready`;
    case "error":
      return `AI ${id} — error${status.detail ? ` (${status.detail})` : ""}`;
  }
}

/** Options for {@link startAiModelWatch}. */
export type StartAiModelWatchOptions = ProbeAiModelStatusOptions & {
  /** Called when the phase (or message) changes. */
  readonly onStatus: (message: string, status: AiModelStatus) => void;
  /** Poll interval (ms). Default 2000. */
  readonly intervalMs?: number;
  /** Give up after this many ms. Default 30 minutes. */
  readonly timeoutMs?: number;
  /** Injectable clock (tests). */
  readonly now?: () => number;
  /** Injectable sleep (tests). */
  readonly sleep?: (ms: number) => Promise<void>;
};

/**
 * Poll model readiness in the background until ready, error, timeout, or stop.
 *
 * @param opts - Probe + callbacks
 * @returns Stop function
 */
export function startAiModelWatch(opts: StartAiModelWatchOptions): () => void {
  const intervalMs = opts.intervalMs ?? 2_000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  let stopped = false;
  let lastMessage = "";
  const startedAt = now();

  const tick = async (): Promise<void> => {
    while (!stopped) {
      const status = await probeAiModelStatus(opts);
      if (stopped) return;
      const message = formatAiModelStatusMessage(status);
      if (message !== lastMessage) {
        lastMessage = message;
        opts.onStatus(message, status);
      }
      if (status.phase === "ready" || status.phase === "error") return;
      if (now() - startedAt >= timeoutMs) {
        const timed: AiModelStatus = {
          model: opts.model,
          phase: "error",
          detail: `still ${status.phase} after ${Math.round(timeoutMs / 60_000)}m`,
        };
        opts.onStatus(formatAiModelStatusMessage(timed), timed);
        return;
      }
      await sleep(intervalMs);
    }
  };

  void tick();
  return () => {
    stopped = true;
  };
}
