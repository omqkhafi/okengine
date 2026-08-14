import { describe, expect, test } from "bun:test";
import { indexDocHaystack, rankIndexHits, tokenizeIndexQuery } from "./index-search.ts";

const DOCS = [
  {
    id: "iss_eng_184",
    meta: { identifier: "ENG-184", title: "Pulse graph on selected trace" },
  },
  {
    id: "iss_eng_185",
    meta: { identifier: "ENG-185", title: "Waterfall tooltip copy" },
  },
  {
    id: "iss_sup_12",
    meta: { identifier: "SUP-12", title: "Customer cannot sign in" },
  },
] as const;

describe("tokenizeIndexQuery", () => {
  test("splits on punctuation and case", () => {
    expect(tokenizeIndexQuery("Pulse-graph!")).toEqual(["pulse", "graph"]);
  });
});

describe("indexDocHaystack", () => {
  test("joins id and string-ish meta", () => {
    expect(indexDocHaystack(DOCS[0])).toContain("iss_eng_184");
    expect(indexDocHaystack(DOCS[0])).toContain("eng-184");
    expect(indexDocHaystack(DOCS[0])).toContain("pulse graph");
  });
});

describe("rankIndexHits", () => {
  test("finds a title phrase", () => {
    const hits = rankIndexHits(DOCS, "pulse graph", 5);
    expect(hits[0]?.id).toBe("iss_eng_184");
    expect(hits[0]?.score).toBeGreaterThan(0.8);
  });

  test("finds an identifier", () => {
    const hits = rankIndexHits(DOCS, "SUP-12", 5);
    expect(hits[0]?.id).toBe("iss_sup_12");
  });

  test("token overlap still ranks", () => {
    const hits = rankIndexHits(DOCS, "cannot sign", 5);
    expect(hits[0]?.id).toBe("iss_sup_12");
  });

  test("empty query returns nothing", () => {
    expect(rankIndexHits(DOCS, "   ", 5)).toEqual([]);
  });

  test("respects topK", () => {
    expect(rankIndexHits(DOCS, "iss", 1)).toHaveLength(1);
  });
});
