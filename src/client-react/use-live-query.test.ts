/**
 * useLiveQuery — reducer, race protocol, optimistic mutate, teardown.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createClient } from "../client/create.ts";
import {
  applyOptimisticPatch,
  clearOptimisticPatch,
  isStaleUpsert,
  reduceLiveQueryRows,
} from "../client/use-live-query.ts";
import { useLiveQuery } from "./use-live-query.ts";

type Task = { id: string; title: string; status: string; updatedAt: number };

function listFlowFrom(rows: Task[]) {
  const calls: unknown[] = [];
  const flow = ((input?: unknown) => {
    calls.push(input);
    return Promise.resolve({
      data: rows,
      error: null,
      next: () => {},
      prev: () => {},
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true as const, value: undefined };
          },
        };
      },
    });
  }) as unknown as Parameters<typeof useLiveQuery<Task>>[0]["listFlow"];
  return { flow, calls };
}

const LIVE = { method: "GET", path: "/tasks/live" };

async function waitFor(pred: () => boolean, ms = 1_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("live query row primitives", () => {
  const idOf = (r: Task) => r.id;

  test("reduce upsert merges by id", () => {
    const rows: Task[] = [{ id: "1", title: "a", status: "open", updatedAt: 1 }];
    const out = reduceLiveQueryRows(rows, idOf, {
      kind: "upsert",
      row: { id: "1", title: "a2", status: "open", updatedAt: 2 },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("a2");
  });

  test("reduce upsert appends unseen ids", () => {
    const out = reduceLiveQueryRows([] as Task[], idOf, {
      kind: "upsert",
      row: { id: "9", title: "n", status: "open", updatedAt: 0 },
    });
    expect(out).toHaveLength(1);
  });

  test("delete and revoked both remove", () => {
    const rows: Task[] = [
      { id: "1", title: "a", status: "open", updatedAt: 1 },
      { id: "2", title: "b", status: "done", updatedAt: 1 },
    ];
    expect(reduceLiveQueryRows(rows, idOf, { kind: "delete", id: "1" })).toHaveLength(1);
    expect(
      reduceLiveQueryRows(rows, idOf, { kind: "revoked", id: "2", reason: "rls" }),
    ).toHaveLength(1);
  });

  test("overrides re-apply over server upserts", () => {
    const overrides = applyOptimisticPatch(undefined, "1", { status: "done" });
    const rows: Task[] = [{ id: "1", title: "a", status: "open", updatedAt: 1 }];
    const merged = reduceLiveQueryRows(
      rows,
      idOf,
      {
        kind: "upsert",
        row: { id: "1", title: "a'", status: "closed", updatedAt: 5 },
      },
      overrides,
    );
    expect(merged[0]).toEqual({ id: "1", title: "a'", status: "done", updatedAt: 5 });
    expect(clearOptimisticPatch(overrides, ["1"]).size).toBe(0);
  });

  test("isStaleUpsert guards on version fields only when comparable", () => {
    const held: Task = { id: "1", title: "a", status: "x", updatedAt: 10 };
    const older: Task = { id: "1", title: "b", status: "y", updatedAt: 5 };
    const newer: Task = { id: "1", title: "c", status: "z", updatedAt: 12 };
    expect(isStaleUpsert(held, older)).toBe(true);
    expect(isStaleUpsert(held, newer)).toBe(false);
    // No comparable version → never stale.
    expect(isStaleUpsert({ ...held, updatedAt: undefined as unknown as number }, newer)).toBe(
      false,
    );
    expect(isStaleUpsert(held, newer, () => null)).toBe(false);
  });
});

describe("useLiveQuery", () => {
  let happy: Window;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    happy = new Window({ url: "http://app.test/" });
    Object.defineProperty(globalThis, "window", {
      value: happy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: happy.document,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    happy.close();
  });

  test("loads snapshot then applies SSE upserts; unmount stops requests", async () => {
    const initialRows: Task[] = [{ id: "t1", title: "one", status: "open", updatedAt: 1 }];
    const list = listFlowFrom(initialRows);

    let sseOpened = 0;
    let pushEvent: ((e: unknown) => void) | undefined;
    const api = createClient("http://app.test", {
      fetch: async (_url, init) => {
        if (init?.method === "GET") {
          sseOpened += 1;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const enc = new TextEncoder();
              pushEvent = (e: unknown) =>
                controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
              // hold open — autoResubscribe must not create a second one
              (controller as unknown as { _hold?: boolean })._hold = true;
            },
            cancel() {
              pushEvent = undefined;
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        throw new Error(`unexpected fetch ${String(init?.method)} ${String(_url)}`);
      },
    });

    const host = happy.document.createElement("div");
    happy.document.body.appendChild(host);
    const seen: { data: readonly Task[] | null; isLoading: boolean; isConnected: boolean } = {
      data: null,
      isLoading: true,
      isConnected: false,
    };

    function Probe(): null {
      const state = useLiveQuery<Task>({
        api,
        listFlow: list.flow,
        query: undefined,
        live: LIVE,
      });
      seen.data = state.data;
      seen.isLoading = state.isLoading;
      seen.isConnected = state.isConnected;
      return null;
    }

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(host as unknown as Element);
      root.render(createElement(Probe));
    });
    await waitFor(() => seen.data !== null && !seen.isLoading);
    expect(seen.data!.map((t) => t.id)).toEqual(["t1"]);
    expect(sseOpened).toBe(1);
    expect(seen.isConnected).toBe(true);

    await act(async () => {
      pushEvent?.({
        kind: "upsert",
        row: { id: "t2", title: "two", status: "open", updatedAt: 2 },
      });
    });
    await waitFor(() => seen.data!.some((t) => t.id === "t2"));

    await act(async () => {
      pushEvent?.({ kind: "delete", id: "t1" });
    });
    await waitFor(() => !seen.data!.some((t) => t.id === "t1"));

    await act(async () => {
      pushEvent?.({
        kind: "upsert",
        row: { id: "t2", title: "two!", status: "done", updatedAt: 3 },
      });
    });
    await waitFor(() => seen.data![0]?.title === "two!");

    await act(async () => {
      root?.unmount();
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(list.calls.length).toBeGreaterThanOrEqual(1);
    host.remove();
  });

  test("snapshot/SSE race: delete event before snapshot lands tombstones the row", async () => {
    const initialRows: Task[] = [
      { id: "gone", title: "will vanish", status: "open", updatedAt: 1 },
      { id: "stay", title: "stays", status: "open", updatedAt: 1 },
    ];
    // Delay the list response so the SSE delete arrives first.
    let releaseList: ((v: void) => void) | undefined;
    const gate = new Promise<void>((r) => (releaseList = r));
    let ssePush: ((e: unknown) => void) | undefined;

    const listFlow = ((input?: unknown) => {
      void input;
      return gate.then(() =>
        Promise.resolve({
          data: initialRows,
          error: null,
          next: () => {},
          prev: () => {},
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return { done: true as const, value: undefined };
              },
            };
          },
        }),
      );
    }) as unknown as Parameters<typeof useLiveQuery<Task>>[0]["listFlow"];

    const api = createClient("http://app.test", {
      fetch: async (_url, init) => {
        if (init?.method === "GET") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const enc = new TextEncoder();
              ssePush = (e: unknown) =>
                controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        throw new Error("unexpected");
      },
    });

    const host = happy.document.createElement("div");
    happy.document.body.appendChild(host);
    const seen: { data: readonly Task[] | null } = { data: null };
    function Probe(): null {
      const state = useLiveQuery<Task>({ api, listFlow, query: undefined, live: LIVE });
      seen.data = state.data;
      return null;
    }
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(host as unknown as Element);
      root.render(createElement(Probe));
    });
    await waitFor(() => ssePush !== undefined);
    await act(async () => {
      ssePush?.({ kind: "delete", id: "gone" });
    });
    await new Promise((r) => setTimeout(r, 30));
    await act(async () => {
      releaseList?.();
    });
    await waitFor(() => seen.data !== null);
    expect(seen.data!.map((t) => t.id)).toEqual(["stay"]);
    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  test("optimistic mutate patches locally, rolls back on failure", async () => {
    const initialRows: Task[] = [{ id: "t1", title: "one", status: "open", updatedAt: 1 }];
    const list = listFlowFrom(initialRows);
    let mutationCalls = 0;
    // Closure flag read per call: `true` → failure envelope.
    let failMutate = true;

    const updateFlow = ((input: unknown) => {
      mutationCalls += 1;
      void input;
      return Promise.resolve(
        failMutate
          ? {
              data: null,
              error: { code: "Forbidden", data: {} },
              next: () => {},
              prev: () => {},
            }
          : {
              data: { id: "t1" },
              error: null,
              next: () => {},
              prev: () => {},
            },
      );
    }) as unknown as Parameters<ReturnType<typeof useLiveQuery<Task>>["mutate"]>[0];

    const api = createClient("http://app.test", {
      fetch: async (_url, init) => {
        if (init?.method === "GET") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              // Keep the SSE leg open; this test drives mutations only.
              void controller;
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        throw new Error("unexpected");
      },
    });

    const host = happy.document.createElement("div");
    happy.document.body.appendChild(host);
    const seen: { data: readonly Task[] | null } = { data: null };
    let mutateRef: ReturnType<typeof useLiveQuery<Task>>["mutate"] | undefined;
    function Probe(): null {
      const state = useLiveQuery<Task>({ api, listFlow: list.flow, query: undefined, live: LIVE });
      seen.data = state.data;
      mutateRef = state.mutate;
      return null;
    }
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(host as unknown as Element);
      root.render(createElement(Probe));
    });
    await waitFor(() => seen.data !== null);

    // Failing mutation rolls back to the pre-mutate snapshot.
    await act(async () => {
      const result = await mutateRef!(
        updateFlow,
        { id: "t1" },
        {
          optimistic: (rows) => rows.map((r) => (r.id === "t1" ? { ...r, status: "archived" } : r)),
          pkOf: (i) => (i as { id: string }).id,
        },
      );
      expect(result.error).not.toBeNull();
    });
    expect(mutationCalls).toBe(1);
    expect(seen.data![0]?.status).toBe("open");

    // Successful mutation patches locally and confirms via result PK.
    failMutate = false;
    await act(async () => {
      const result = await mutateRef!(
        updateFlow,
        { id: "t1" },
        {
          optimistic: (rows) => rows.map((r) => (r.id === "t1" ? { ...r, status: "done" } : r)),
          pkOf: (i) => (i as { id: string }).id,
        },
      );
      expect(result.error).toBeNull();
    });
    expect(mutationCalls).toBe(2);
    expect(seen.data![0]?.status).toBe("done");

    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });
});
