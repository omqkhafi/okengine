/**
 * `meilisearch` index driver — full-text search over the Meilisearch HTTP API.
 *
 * Product-as-protocol id (same pattern as `pgvector`); the image
 * pin lives in `images["store.index"]` (e.g. `getmeili/meilisearch`). This is
 * a genuinely different capability from the vector ANN drivers — typo-tolerant
 * / faceted full-text relevance, not cosine similarity.
 *
 * Fail-loud: a configured Meilisearch that is unreachable, unhealthy, or
 * rejects a call throws {@link MeilisearchUnavailableError} — never silently
 * falls back to memory. Writes wait for their task to succeed (Meilisearch is
 * asynchronous), so an `upsert`/`delete` only resolves once the server has
 * actually indexed it.
 */

import type {
  IndexHit,
  IndexOpenOptions,
  TextIndexDriver,
  TextIndexSearchOptions,
  TextIndexSearchResult,
  TextIndexStore,
} from "./types.ts";

/** Error thrown when the remote Meilisearch is unreachable / unhealthy / errors. */
export class MeilisearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeilisearchUnavailableError";
  }
}

/** Minimal response shape of a Meilisearch summarized / finished task. */
interface MeiliTask {
  readonly taskUid: number;
  readonly status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
  readonly error?: { readonly message?: string; readonly code?: string } | null;
}

/** Search response hit shape we consume. */
interface MeiliSearchResponse {
  readonly hits?: ReadonlyArray<Record<string, unknown> & { readonly _rankingScore?: number }>;
  readonly facetDistribution?: Record<string, Record<string, number>>;
}

/** True when a failed task is an accepted no-op (create raced / already present). */
function isOkTaskError(task: MeiliTask, okErrorCodes: readonly string[] | undefined): boolean {
  if (!okErrorCodes || okErrorCodes.length === 0) return false;
  const code = task.error?.code;
  if (code !== undefined && okErrorCodes.includes(code)) return true;
  const message = task.error?.message ?? "";
  return okErrorCodes.includes("index_already_exists") && /already exists/i.test(message);
}

/**
 * GET the index; create only on 404. A concurrent create that loses the race
 * finishes as `index_already_exists` — that is success, not an outage.
 */
async function ensureIndex(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  waitForTask: (
    taskUid: number,
    opts?: { readonly okErrorCodes?: readonly string[] },
  ) => Promise<void>,
  name: string,
  uid: string,
): Promise<void> {
  const existing = await request(`/indexes/${uid}`);
  if (existing.ok) {
    await existing.json().catch(() => null);
    return;
  }
  if (existing.status !== 404) {
    const detail = await existing.text().catch(() => "");
    throw new MeilisearchUnavailableError(
      `meilisearch index: GET /indexes/${uid} failed (${existing.status})${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
    );
  }
  await existing.text().catch(() => "");
  const created = await request("/indexes", {
    method: "POST",
    body: JSON.stringify({ uid: name, primaryKey: "id" }),
  });
  if (created.status === 409) {
    await created.text().catch(() => "");
    return;
  }
  if (!created.ok) {
    const detail = await created.text().catch(() => "");
    throw new MeilisearchUnavailableError(
      `meilisearch index: POST /indexes failed (${created.status})${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const task = (await created.json()) as MeiliTask;
  await waitForTask(task.taskUid, { okErrorCodes: ["index_already_exists"] });
}

/** Options for opening a Meilisearch-backed text index. */
export interface MeilisearchIndexOptions extends IndexOpenOptions {
  /** Max ms to wait for an indexing task to finish (default 5000). */
  readonly taskTimeoutMs?: number;
}

/**
 * Open a full-text index.
 *
 * Ensures the index exists, health-checks the server, and returns a handle
 * whose writes are confirmed (task-waited) and whose search maps
 * `_rankingScore` into `IndexHit.score` as relevance.
 *
 * @param options - name / url / apiKey / injected fetch
 */
export async function openMeilisearchIndex(
  options: MeilisearchIndexOptions,
): Promise<TextIndexStore> {
  const url = options.url?.replace(/\/$/, "");
  if (!url) {
    throw new MeilisearchUnavailableError(
      "meilisearch index: needs an HTTP URL (OKE_STORE_INDEX_URL) — no silent memory fallback",
    );
  }
  const apiKey = options.apiKey;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const taskTimeoutMs = options.taskTimeoutMs ?? 5_000;
  const uid = encodeURIComponent(options.name);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchFn(`${url}${path}`, {
        ...init,
        headers: { ...headers, ...(init?.headers ?? {}) },
      });
    } catch (err) {
      throw new MeilisearchUnavailableError(
        `meilisearch index: unreachable at ${url} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return res;
  }

  async function requestOk(path: string, init?: RequestInit): Promise<Response> {
    const res = await request(path, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new MeilisearchUnavailableError(
        `meilisearch index: ${init?.method ?? "GET"} ${path} failed (${res.status})${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
      );
    }
    return res;
  }

  async function enqueue(path: string, init: RequestInit): Promise<MeiliTask> {
    const res = await requestOk(path, init);
    return (await res.json()) as MeiliTask;
  }

  async function waitForTask(
    taskUid: number,
    opts?: { readonly okErrorCodes?: readonly string[] },
  ): Promise<void> {
    const deadline = Date.now() + taskTimeoutMs;
    // Poll the task until it leaves the queue; treat a failed/canceled task as
    // a loud error rather than an optimistic write.
    for (;;) {
      const res = await requestOk(`/tasks/${taskUid}`);
      const task = (await res.json()) as MeiliTask;
      if (task.status === "succeeded") return;
      if (task.status === "failed" && isOkTaskError(task, opts?.okErrorCodes)) return;
      if (task.status === "failed" || task.status === "canceled") {
        throw new MeilisearchUnavailableError(
          `meilisearch index: task ${taskUid} ${task.status}${task.error?.message ? ` — ${task.error.message}` : ""}`,
        );
      }
      if (Date.now() > deadline) {
        throw new MeilisearchUnavailableError(
          `meilisearch index: task ${taskUid} did not finish within ${taskTimeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  // Fail loud up front: server must be healthy and the index must exist
  // (created if absent) before we hand back a usable handle. Re-open is
  // idempotent — Meilisearch fails a second create with index_already_exists.
  await requestOk("/health");
  await ensureIndex(request, waitForTask, options.name, uid);

  const scoreOf = (hit: { readonly _rankingScore?: unknown }): number =>
    typeof hit._rankingScore === "number" ? hit._rankingScore : 0;

  return {
    driverId: "meilisearch",
    async upsert(id, document) {
      const body = [{ ...document, id }];
      const task = await enqueue(`/indexes/${uid}/documents`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await waitForTask(task.taskUid);
    },
    async search(q, opts?: TextIndexSearchOptions): Promise<TextIndexSearchResult> {
      const payload: Record<string, unknown> = {
        q,
        limit: opts?.topK ?? 10,
        showRankingScore: true,
      };
      if (opts?.filter !== undefined) payload.filter = opts.filter;
      if (opts?.facets !== undefined) payload.facets = opts.facets;
      const res = await requestOk(`/indexes/${uid}/search`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as MeiliSearchResponse;
      const hits: IndexHit[] = (body.hits ?? []).map((hit) => {
        const { _rankingScore, ...rest } = hit;
        void _rankingScore;
        const meta = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "id"));
        return {
          id: String(rest.id ?? ""),
          score: scoreOf(hit),
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        };
      });
      return {
        hits,
        ...(body.facetDistribution !== undefined
          ? { facetDistribution: body.facetDistribution }
          : {}),
      };
    },
    async delete(id) {
      const res = await request(`/indexes/${uid}/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.status === 404) return false;
      if (!res.ok) {
        throw new MeilisearchUnavailableError(
          `meilisearch index: delete ${id} failed (${res.status})`,
        );
      }
      const task = (await res.json()) as MeiliTask;
      await waitForTask(task.taskUid);
      return true;
    },
    async list(limit = 100) {
      const res = await requestOk(
        `/indexes/${uid}/documents?limit=${Math.max(1, Math.floor(limit))}`,
      );
      const body = (await res.json()) as {
        readonly results?: ReadonlyArray<Record<string, unknown>>;
      };
      return (body.results ?? []).map((doc) => {
        const meta = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "id"));
        return {
          id: String(doc.id ?? ""),
          score: 0,
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        };
      });
    },
    async close() {
      // Stateless HTTP client — nothing to release.
    },
  };
}

/** Protocol-named Meilisearch driver. */
export const meilisearchDriver: TextIndexDriver = {
  id: "meilisearch",
  facet: "index",
  open: openMeilisearchIndex,
};
