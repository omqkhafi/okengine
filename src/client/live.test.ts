/**
 * Client live subscribe — callback + unsubscribe + autoResubscribe.
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "./create.ts";
import * as client from "./index.ts";
import { pickLiveExposure, type LiveExposure } from "./live.ts";
import type { AppOf } from "./types.ts";

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
    const fetchFn = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
      }
      return sseResponse([payload]);
    };
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
    const hanging = (): Response => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const fetchOn = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
      }
      return hanging();
    };
    const apiOn = createClient<EventsApp>("http://app.test", { fetch: fetchOn, $routes: routes });
    const stopOn = apiOn.live(
      orderStatus,
      { orderId: "ord_1" },
      {
        onEvent: (e) => recovered.push(e),
        autoResubscribe: true,
      },
    );
    await waitFor(() => recovered.length === 1);
    expect(recovered).toEqual([payload]);
    stopOn();

    calls = 0;
    const later: unknown[] = [];
    let err: unknown;
    const apiOff = createClient<EventsApp>("http://app.test", { fetch: fetchFn, $routes: routes });
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
});

async function waitFor(pred: () => boolean, ms = 500): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
