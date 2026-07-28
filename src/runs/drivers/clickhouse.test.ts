/**
 * ClickHouse runs driver — fake path + HTTP client contract.
 */

import { describe, expect, test } from "bun:test";
import {
  clickhouseRunsDriver,
  createRunsClickHouseHttp,
  ensureClickHouseRunsTable,
} from "./clickhouse.ts";
import type { WideEvent } from "../types.ts";

function event(id: string): WideEvent {
  const t = Date.now();
  return {
    id,
    flow: "main.x",
    trigger: "internal",
    plane: "user",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    durationMs: 3,
    startedAt: t,
    endedAt: t + 3,
    dimensions: { flow: "main.x" },
    error: null,
  };
}

describe("clickhouseRunsDriver", () => {
  test("fake client appends and queries", async () => {
    const store = await clickhouseRunsDriver.open();
    await store.append(event("a"));
    const rows = await store.query("SELECT count() AS count FROM oke_runs");
    expect(Number(rows[0]!.count)).toBe(1);
    expect(await store.all()).toHaveLength(1);
    await store.close();
  });

  test("HTTP client issues JSONEachRow insert and JSON query", async () => {
    const calls: { query: string; body?: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        query: url.searchParams.get("query") ?? "",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if ((url.searchParams.get("query") ?? "").includes("CREATE TABLE")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if ((url.searchParams.get("query") ?? "").includes("INSERT")) {
        return new Response("", { status: 200 });
      }
      return new Response(
        JSON.stringify({ data: [{ count: 1 }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const client = createRunsClickHouseHttp("http://127.0.0.1:8123", {
        database: "oke",
      });
      await ensureClickHouseRunsTable(client, "oke_runs");
      await client.insert("oke_runs", [
        { id: "1", flow: "x", duration_ms: 1, payload: "{}" },
      ]);
      const rows = await client.query("SELECT count() AS count FROM oke_runs");
      expect(rows[0]).toEqual({ count: 1 });
      expect(calls.some((c) => c.query.includes("INSERT"))).toBe(true);
      expect(calls.some((c) => c.query.includes("FORMAT JSON"))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("open({ url }) uses HTTP client", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const q = url.searchParams.get("query") ?? "";
      if (q.includes("CREATE TABLE") || q.includes("INSERT")) {
        return new Response("", { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const store = await clickhouseRunsDriver.open({
        url: "http://127.0.0.1:8123",
      });
      await store.append(event("http-1"));
      expect(await store.all()).toHaveLength(1);
      await store.close();
    } finally {
      globalThis.fetch = original;
    }
  });
});
