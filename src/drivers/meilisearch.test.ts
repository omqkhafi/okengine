/**
 * `meilisearch` index driver — task-waited writes, relevance search mapping,
 * and fail-loud semantics against an injected fetch (never a live server).
 */

import { describe, expect, test } from "bun:test";
import {
  MeilisearchUnavailableError,
  meilisearchDriver,
  openMeilisearchIndex,
} from "./meilisearch.ts";

/** A scripted Meilisearch over the wire — in-memory task + document store. */
export function createMeilisearchFakeFetch(opts?: {
  readonly failHealth?: boolean;
  readonly failTask?: boolean;
}): typeof fetch {
  const documents = new Map<string, Record<string, unknown>>();
  const taskResults = new Map<number, { fail: boolean }>();
  let taskSeq = 0;

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const task = (type: string, fail: boolean): object => {
    taskSeq += 1;
    taskResults.set(taskSeq, { fail });
    return { taskUid: taskSeq, indexUid: "kb", status: "enqueued", type };
  };

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";

    if (url.endsWith("/health")) {
      if (opts?.failHealth) return json({ message: "down" }, 503);
      return json({ status: "available" });
    }

    if (url.endsWith("/indexes") && method === "POST") {
      return json(task("indexCreation", false), 202);
    }

    if (url.includes("/tasks/")) {
      const taskUid = Number(url.split("/tasks/")[1]);
      const fail = taskResults.get(taskUid)?.fail ?? false;
      return json({
        taskUid,
        status: fail ? "failed" : "succeeded",
        error: fail ? { message: "boom" } : null,
      });
    }

    if (url.includes("/documents") && method === "GET" && !url.includes("/documents/")) {
      const limit = Number(new URL(url).searchParams.get("limit") ?? 100);
      return json({
        results: [...documents.values()].slice(0, Number.isFinite(limit) ? limit : 100),
      });
    }

    if (url.includes("/documents/") && method === "DELETE") {
      const id = decodeURIComponent(url.split("/documents/")[1] ?? "");
      if (!documents.delete(id)) return json({ message: "not found" }, 404);
      return json(task("documentDeletion", opts?.failTask ?? false), 202);
    }

    if (url.endsWith("/documents") && method === "POST") {
      const docs = JSON.parse(String(init?.body ?? "[]")) as Record<string, unknown>[];
      if (!(opts?.failTask ?? false)) {
        for (const doc of docs) documents.set(String(doc.id), doc);
      }
      return json(task("documentAdditionOrUpdate", opts?.failTask ?? false), 202);
    }

    if (url.endsWith("/search") && method === "POST") {
      const {
        q,
        limit = 10,
        facets,
      } = JSON.parse(String(init?.body ?? "{}")) as {
        q?: string;
        limit?: number;
        facets?: string[];
      };
      const query = (q ?? "").toLowerCase();
      const hits = [...documents.values()]
        .filter((doc) => query === "" || JSON.stringify(doc).toLowerCase().includes(query))
        .slice(0, limit)
        .map((doc) => ({ ...doc, _rankingScore: 0.95 }));
      const facetDistribution: Record<string, Record<string, number>> = {};
      for (const facet of facets ?? []) {
        facetDistribution[facet] = { tagged: documents.size };
      }
      return json({
        hits,
        ...(facets && facets.length > 0 ? { facetDistribution } : {}),
        estimatedTotalHits: hits.length,
      });
    }

    return json({ message: `no route for ${method} ${url}` }, 404);
  }) as typeof fetch;
}

describe("meilisearch driver", () => {
  test("upsert → search maps _rankingScore into relevance score", async () => {
    const index = await openMeilisearchIndex({
      name: "kb",
      dims: 0,
      url: "http://127.0.0.1:7700",
      apiKey: "master-key",
      fetch: createMeilisearchFakeFetch(),
    });
    await index.upsert("d1", { title: "hello world", tag: "a" });
    await index.upsert("d2", { title: "goodbye world", tag: "b" });

    const found = await index.search("hello", { topK: 1 });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]?.id).toBe("d1");
    expect(found.hits[0]?.score).toBeGreaterThan(0);
    expect(found.hits[0]?.meta).toMatchObject({ title: "hello world", tag: "a" });
    await index.close();
  });

  test("facets return a facetDistribution", async () => {
    const index = await openMeilisearchIndex({
      name: "kb",
      dims: 0,
      url: "http://127.0.0.1:7700",
      fetch: createMeilisearchFakeFetch(),
    });
    await index.upsert("d1", { title: "x", tag: "a" });
    const found = await index.search("x", { facets: ["tag"] });
    expect(found.facetDistribution).toEqual({ tag: { tagged: 1 } });
    await index.close();
  });

  test("list returns stored documents without a query", async () => {
    const index = await openMeilisearchIndex({
      name: "kb",
      dims: 0,
      url: "http://127.0.0.1:7700",
      fetch: createMeilisearchFakeFetch(),
    });
    await index.upsert("d1", { title: "hello world" });
    await index.upsert("d2", { title: "goodbye world" });
    const listed = await index.list(10);
    expect(listed.map((hit) => hit.id).sort()).toEqual(["d1", "d2"]);
    expect(listed[0]?.score).toBe(0);
    await index.close();
  });

  test("delete removes the document; missing id is false", async () => {
    const index = await openMeilisearchIndex({
      name: "kb",
      dims: 0,
      url: "http://127.0.0.1:7700",
      fetch: createMeilisearchFakeFetch(),
    });
    await index.upsert("d1", { title: "x" });
    expect(await index.delete("d1")).toBe(true);
    expect(await index.delete("d1")).toBe(false);
    await index.close();
  });

  test("missing URL fails loud (no memory fallback)", async () => {
    await expect(openMeilisearchIndex({ name: "kb", dims: 0 })).rejects.toBeInstanceOf(
      MeilisearchUnavailableError,
    );
  });

  test("unhealthy server fails loud at open", async () => {
    await expect(
      openMeilisearchIndex({
        name: "kb",
        dims: 0,
        url: "http://127.0.0.1:7700",
        fetch: createMeilisearchFakeFetch({ failHealth: true }),
      }),
    ).rejects.toBeInstanceOf(MeilisearchUnavailableError);
  });

  test("a failed indexing task surfaces as a loud error, not a silent write", async () => {
    const index = await openMeilisearchIndex({
      name: "kb",
      dims: 0,
      url: "http://127.0.0.1:7700",
      fetch: createMeilisearchFakeFetch({ failTask: true }),
    });
    await expect(index.upsert("d1", { title: "x" })).rejects.toBeInstanceOf(
      MeilisearchUnavailableError,
    );
    await index.close();
  });

  test("driver id + facet", () => {
    expect(meilisearchDriver.id).toBe("meilisearch");
    expect(meilisearchDriver.facet).toBe("index");
  });
});
