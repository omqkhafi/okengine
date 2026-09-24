/**
 * Client live subscribe — callback + unsubscribe + autoResubscribe.
 */

import { describe, expect, test } from "bun:test";
import { __setLiveChunkLoaderForTests, __setStreamChunkLoaderForTests } from "./chunks.ts";
import { createClient } from "./create.ts";
import * as client from "./index.ts";
import {
  LIVE_RESUBSCRIBE_INITIAL_MS,
  LIVE_RESUBSCRIBE_MAX_MS,
  nextResubscribeDelay,
} from "./live.ts";
import { pickLiveExposure, type LiveExposure } from "./route-tables.ts";
import type { AppOf } from "./types.ts";

type NotesGetApp = AppOf<{
  notes: {
    get: {
      in: { id: string };
      out: { ok: boolean };
      method: "GET";
      path: "/notes/:id";
    };
  };
}>;

type NotesTailApp = AppOf<{
  notes: {
    tail: {
      out: { n: number };
      method: "GET";
      path: "/notes/tail";
      stream: true;
    };
  };
}>;

type EventsApp = AppOf<{
  orders: {
    events: {
      in: { orderId: string };
      out: { orderId: string; status: string };
      method: "GET";
      path: "/orders/:orderId/events";
      live: "order-status";
      matchKey: ["orderId"];
      stream: true;
    };
  };
  admin: {
    adminFeed: {
      out: { orderId: string; status: string };
      method: "GET";
      path: "/admin/order-status";
      live: "order-status";
      matchKey: [];
      stream: true;
    };
  };
}>;

const orderStatus = {
  name: "order-status",
  _payload: undefined as { orderId: string; status: string } | undefined,
};

function sseResponse(frames: readonly unknown[], ids?: readonly string[]): Response {
  const lines: string[] = [];
  frames.forEach((payload, i) => {
    const id = ids?.[i];
    if (id !== undefined) lines.push(`id: ${id}`);
    lines.push(`data: ${JSON.stringify(payload)}`);
    lines.push("");
  });
  lines.push("data: [DONE]");
  lines.push("");
  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("pickLiveExposure", () => {
  const member: LiveExposure = {
    flow: "orders.events",
    method: "GET",
    path: "/orders/:orderId/events",
    matchKey: ["orderId"],
  };
  const partner: LiveExposure = {
    flow: "partners.events",
    method: "GET",
    path: "/partners/:orderId/events",
    matchKey: ["orderId"],
  };
  const firehose: LiveExposure = {
    flow: "admin.adminFeed",
    method: "GET",
    path: "/admin/order-status",
    matchKey: [],
  };

  test("prefers the largest matchKey subset", () => {
    expect(pickLiveExposure([member, firehose], { orderId: "ord_1" }).flow).toBe("orders.events");
    expect(pickLiveExposure([member, firehose], {}).flow).toBe("admin.adminFeed");
  });

  test("tie requires via", () => {
    expect(() => pickLiveExposure([member, partner], { orderId: "ord_1" })).toThrow(/via/);
    expect(pickLiveExposure([member, partner], { orderId: "ord_1" }, "partners.events").flow).toBe(
      "partners.events",
    );
  });
});

describe("createClient — live", () => {
  test("public client module exports createClient (live is on the instance)", () => {
    expect(Object.keys(client)).toContain("createClient");
  });

  test("root api.live is a function", () => {
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async () => sseResponse([]),
      $routes: {
        orders: {
          events: {
            method: "GET",
            path: "/orders/:orderId/events",
            live: "order-status",
            matchKey: ["orderId"],
            stream: true,
          },
        },
        admin: {
          adminFeed: {
            method: "GET",
            path: "/admin/order-status",
            live: "order-status",
            matchKey: [],
            stream: true,
          },
        },
      },
    });
    expect(typeof api).toBe("function");
    expect(typeof api.live).toBe("function");
  });

  test("onEvent receives schema-shaped payloads; unsubscribe stops delivery", async () => {
    const seen: unknown[] = [];
    let pull!: (chunk: Uint8Array) => void;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        pull = (chunk) => controller.enqueue(chunk);
        close = () => controller.close();
      },
    });
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      $routes: {
        orders: {
          events: {
            method: "GET",
            path: "/orders/:orderId/events",
            live: "order-status",
            matchKey: ["orderId"],
            stream: true,
          },
        },
      },
    });

    const stop = api.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: (event) => {
          seen.push(event);
        },
      },
    );

    const enc = new TextEncoder();
    pull(enc.encode(`data: ${JSON.stringify({ orderId: "ord_1", status: "placed" })}\n\n`));
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ orderId: "ord_1", status: "placed" }]);
    stop();
    pull(enc.encode(`data: ${JSON.stringify({ orderId: "ord_1", status: "shipped" })}\n\n`));
    close();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ orderId: "ord_1", status: "placed" }]);
  });

  test("autoResubscribe true delivers after a drop; false does not", async () => {
    let calls = 0;
    const payload = { orderId: "ord_1", status: "placed" };
    const routes = {
      orders: {
        events: {
          method: "GET" as const,
          path: "/orders/:orderId/events",
          live: "order-status",
          matchKey: ["orderId"] as const,
          stream: true as const,
        },
      },
    };

    const recovered: unknown[] = [];
    const closingThenEvent = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
      }
      return sseResponse([payload]);
    };
    const apiOn = createClient<EventsApp>("http://app.test", {
      fetch: closingThenEvent,
      $routes: routes,
    });
    const stopOn = apiOn.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: (e) => recovered.push(e),
        autoResubscribe: true,
      },
    );
    await waitFor(() => recovered.length === 1, 2000);
    expect(recovered).toEqual([payload]);
    expect(calls).toBe(2);
    stopOn();

    calls = 0;
    const later: unknown[] = [];
    let err: unknown;
    const fetchOff = async (): Promise<Response> => {
      calls += 1;
      return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
    };
    const apiOff = createClient<EventsApp>("http://app.test", { fetch: fetchOff, $routes: routes });
    const stopOff = apiOff.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: (e) => later.push(e),
        onError: (e) => {
          err = e;
        },
      },
    );
    await waitFor(() => err !== undefined);
    expect(later).toEqual([]);
    expect(calls).toBe(1);
    stopOff();
  });

  test("autoResubscribe backoff is exponential and capped", () => {
    expect(LIVE_RESUBSCRIBE_INITIAL_MS).toBe(500);
    expect(LIVE_RESUBSCRIBE_MAX_MS).toBe(30_000);
    expect(nextResubscribeDelay(500)).toBe(1000);
    expect(nextResubscribeDelay(1000)).toBe(2000);
    expect(nextResubscribeDelay(16_000)).toBe(30_000);
    expect(nextResubscribeDelay(30_000)).toBe(30_000);
  });

  test("autoResubscribe throttles immediately-closing streams (2s window)", async () => {
    let calls = 0;
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async () => {
        calls += 1;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
      $routes: {
        orders: {
          events: {
            method: "GET",
            path: "/orders/:orderId/events",
            live: "order-status",
            matchKey: ["orderId"],
            stream: true,
          },
        },
      },
    });
    const stop = api.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: () => undefined,
        autoResubscribe: true,
      },
    );
    await new Promise((r) => setTimeout(r, 2000));
    stop();
    // Unthrottled: thousands. 500ms then 1s then 2s → 3 attempts in 2s.
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThan(10);
  }, 10_000);

  test("unsubscribe during backoff does not open another request", async () => {
    let calls = 0;
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async () => {
        calls += 1;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
      $routes: {
        orders: {
          events: {
            method: "GET",
            path: "/orders/:orderId/events",
            live: "order-status",
            matchKey: ["orderId"],
            stream: true,
          },
        },
      },
    });
    const stop = api.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: () => undefined,
        autoResubscribe: true,
      },
    );
    await waitFor(() => calls === 1);
    stop();
    await new Promise((r) => setTimeout(r, 1500));
    expect(calls).toBe(1);
  }, 10_000);

  test("reconnect sends Last-Event-ID; 410 clears cursor and replays", async () => {
    const seenHeaders: Array<string | null> = [];
    let calls = 0;
    const events: unknown[] = [];
    const errors: unknown[] = [];
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async (_url, init) => {
        calls += 1;
        const h = new Headers(init?.headers);
        seenHeaders.push(h.get("last-event-id"));
        if (calls === 1) {
          return sseResponse([{ orderId: "ord_1", status: "placed" }], ["evt-1"]);
        }
        if (calls === 2) {
          return Response.json(
            {
              data: null,
              error: { code: "LiveResumeGap", data: { signal: "order-status", afterId: "evt-1" } },
            },
            { status: 410 },
          );
        }
        return sseResponse([{ orderId: "ord_1", status: "shipped" }], ["evt-2"]);
      },
      $routes: {
        orders: {
          events: {
            method: "GET",
            path: "/orders/:orderId/events",
            live: "order-status",
            matchKey: ["orderId"],
            stream: true,
          },
        },
      },
    });
    const stop = api.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: (e) => events.push(e),
        onError: (e) => errors.push(e),
        autoResubscribe: true,
      },
    );
    await waitFor(() => events.length >= 2, 8_000);
    stop();
    expect(seenHeaders[0]).toBeNull();
    expect(seenHeaders[1]).toBe("evt-1");
    expect(seenHeaders[2]).toBeNull();
    expect(events).toEqual([
      { orderId: "ord_1", status: "placed" },
      { orderId: "ord_1", status: "shipped" },
    ]);
    expect(errors.some((e) => e instanceof Error && e.message.includes("LiveResumeGap"))).toBe(
      true,
    );
  }, 10_000);

  test("flow-scoped subscribe is unambiguous", async () => {
    const seen: unknown[] = [];
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async (url) => {
        expect(String(url)).toContain("/orders/ord_1/events");
        return sseResponse([{ orderId: "ord_1", status: "placed" }]);
      },
      $routes: {
        orders: {
          events: {
            method: "GET",
            path: "/orders/:orderId/events",
            live: "order-status",
            matchKey: ["orderId"],
            stream: true,
          },
        },
      },
    });
    const stop = api.orders.events(
      { orderId: "ord_1" },
      {
        onEvent: (event) => {
          seen.push(event);
        },
      },
    );
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ orderId: "ord_1", status: "placed" }]);
    stop();
  });

  test("unsubscribe before the live chunk loads does not open a request", async () => {
    let calls = 0;
    let release!: (mod: Awaited<typeof import("./live.ts")>) => void;
    const gate = new Promise<Awaited<typeof import("./live.ts")>>((resolve) => {
      release = resolve;
    });
    __setLiveChunkLoaderForTests(() => gate);
    try {
      const api = createClient<EventsApp>("http://app.test", {
        fetch: async () => {
          calls += 1;
          return sseResponse([]);
        },
        $routes: {
          orders: {
            events: {
              method: "GET",
              path: "/orders/:orderId/events",
              live: "order-status",
              matchKey: ["orderId"],
              stream: true,
            },
          },
        },
      });
      const stop = api.live(orderStatus, { orderId: "ord_1" }, { onEvent: () => undefined });
      stop();
      release(await import("./live.ts"));
      await new Promise((r) => setTimeout(r, 30));
      expect(calls).toBe(0);
    } finally {
      __setLiveChunkLoaderForTests(null);
    }
  });

  test("a plain call does not load the live or stream chunks", async () => {
    let liveLoads = 0;
    let streamLoads = 0;
    __setLiveChunkLoaderForTests(() => {
      liveLoads += 1;
      return import("./live.ts");
    });
    __setStreamChunkLoaderForTests(() => {
      streamLoads += 1;
      return import("./stream.ts");
    });
    try {
      const api = createClient<NotesGetApp>("http://app.test", {
        fetch: async () => Response.json({ data: { ok: true }, error: null }),
        $routes: {
          notes: { get: { method: "GET", path: "/notes/:id" } },
        },
      });
      const result = await api.notes.get({ id: "n_1" });
      expect(result.error).toBeNull();
      expect(liveLoads).toBe(0);
      expect(streamLoads).toBe(0);
    } finally {
      __setLiveChunkLoaderForTests(null);
      __setStreamChunkLoaderForTests(null);
    }
  });

  test("finite stream yields events", async () => {
    const api = createClient<NotesTailApp>("http://app.test", {
      fetch: async () => sseResponse([{ n: 1 }, { n: 2 }]),
      $routes: {
        notes: { tail: { method: "GET", path: "/notes/tail", stream: true } },
      },
    });
    const seen: unknown[] = [];
    for await (const event of api.notes.tail()) seen.push(event);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe("sseError — envelope message fallback", () => {
  test("prefers top-level error.message", async () => {
    const { sseError } = await import("./sse.ts");
    const err = sseError(
      401,
      JSON.stringify({
        data: null,
        error: { code: "Unauthorized", message: "Auth required", data: {} },
      }),
    );
    expect(err.message).toBe("Auth required");
  });

  test("falls back to error.data.message", async () => {
    const { sseError } = await import("./sse.ts");
    const err = sseError(
      401,
      JSON.stringify({
        data: null,
        error: { code: "Unauthorized", data: { message: "Auth required" } },
      }),
    );
    expect(err.message).toBe("Auth required");
  });

  test("falls back to error.code", async () => {
    const { sseError } = await import("./sse.ts");
    const err = sseError(
      401,
      JSON.stringify({
        data: null,
        error: { code: "Unauthorized" },
      }),
    );
    expect(err.message).toBe("Unauthorized");
  });

  test("falls back to HTTP status for plain body", async () => {
    const { sseError } = await import("./sse.ts");
    const err = sseError(401, "nope");
    expect(err.message).toBe("nope");
  });
});

async function waitFor(pred: () => boolean, ms = 500): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
