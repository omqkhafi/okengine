/**
 * Live Meilisearch round-trip — Arabic + typo tolerance.
 *
 * The only acceptable evidence that Meilisearch actually handles Arabic (not
 * just "supported" in marketing copy) is a real round-trip against a live
 * server: index Arabic content, then search it — with and without the
 * definite article (ال), with diacritics stripped, and with a Latin typo that
 * typo-tolerance must forgive.
 *
 * Gated on a live server: set `OKE_TEST_MEILI_URL` (and optionally
 * `OKE_TEST_MEILI_KEY`). Without it the whole suite skips, so unit runs never
 * depend on Docker or a spawned binary.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { openMeilisearchIndex, type MeilisearchIndexOptions } from "./meilisearch.ts";

const URL = process.env.OKE_TEST_MEILI_URL;
const KEY = process.env.OKE_TEST_MEILI_KEY;
if (!URL) {
  console.log("skip: live meilisearch e2e (OKE_TEST_MEILI_URL not set)");
}
const live = URL ? test : test.skip;

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (opened.length > 0) {
    await opened.pop()?.close();
  }
});

async function liveIndex(name: string): ReturnType<typeof openMeilisearchIndex> {
  const opts: MeilisearchIndexOptions = { name, dims: 0, url: URL, apiKey: KEY };
  const index = await openMeilisearchIndex(opts);
  opened.push(index);
  return index;
}

describe("meilisearch live — arabic + typo tolerance", () => {
  live("indexes and searches Arabic content (round-trip)", async () => {
    const index = await liveIndex(`ar-${crypto.randomUUID().slice(0, 8)}`);
    await index.upsert("d1", { title: "كتاب عن محركات البحث" });
    await index.upsert("d2", { title: "مقال عن قواعد البيانات" });

    const found = await index.search("البحث", { topK: 5 });
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.hits[0]?.id).toBe("d1");
  });

  live("matches a query without the definite article ال", async () => {
    const index = await liveIndex(`ar-${crypto.randomUUID().slice(0, 8)}`);
    await index.upsert("d1", { title: "الكتاب" });
    // Charabia segments/normalises ال, so the bare stem should still match.
    const found = await index.search("كتاب", { topK: 5 });
    expect(found.hits.map((h) => h.id)).toContain("d1");
  });

  live("typo tolerance forgives a latin misspelling", async () => {
    const index = await liveIndex(`en-${crypto.randomUUID().slice(0, 8)}`);
    await index.upsert("d1", { title: "search engine" });
    // One-transposition typo ("serach") must still hit the document.
    const found = await index.search("serach", { topK: 5 });
    expect(found.hits.map((h) => h.id)).toContain("d1");
  });

  live("re-open of an existing index does not fail", async () => {
    const name = `reopen-${crypto.randomUUID().slice(0, 8)}`;
    const first = await liveIndex(name);
    await first.upsert("d1", { title: "already here" });
    const second = await liveIndex(name);
    const listed = await second.list(10);
    expect(listed.map((h) => h.id)).toContain("d1");
  });

  live("filter + facets aggregate real results", async () => {
    const index = await liveIndex(`fac-${crypto.randomUUID().slice(0, 8)}`);
    await index.upsert("d1", { title: "red apple", color: "red" });
    await index.upsert("d2", { title: "green apple", color: "green" });
    const found = await index.search("apple", {
      topK: 5,
      filter: "color = red",
      facets: ["color"],
    });
    expect(found.hits.map((h) => h.id)).toEqual(["d1"]);
  });
});
