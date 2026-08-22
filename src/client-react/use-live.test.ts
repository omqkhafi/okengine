/**
 * useLive — mount/unmount and typed event state.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createClient } from "../client/create.ts";
import type { AppOf, LiveSignalHandle } from "../client/types.ts";
import { useLive } from "./index.ts";

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
}>;

type Payload = { orderId: string; status: string };

const orderStatus: LiveSignalHandle<Payload> = {
  name: "order-status",
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

async function waitFor(pred: () => boolean, ms = 1_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("useLive", () => {
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

  test("collects events and latest; unmount stops fetches", async () => {
    let calls = 0;
    const payload = { orderId: "ord_1", status: "placed" as const };
    const api = createClient<EventsApp>("http://app.test", {
      fetch: async () => {
        calls += 1;
        return sseResponse([payload], ["evt-1"]);
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

    const host = happy.document.createElement("div");
    happy.document.body.appendChild(host);
    const seen: { latest: Payload | null; events: Payload[] } = { latest: null, events: [] };

    function Probe(): null {
      const state = useLive(api, orderStatus, { orderId: "ord_1" });
      seen.latest = state.latest;
      seen.events = state.events;
      return null;
    }

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(host as unknown as Element);
      root.render(createElement(Probe));
    });
    await waitFor(() => seen.events.length === 1);
    expect(seen.latest).toEqual(payload);
    expect(seen.events).toEqual([payload]);
    expect(calls).toBe(1);

    await act(async () => {
      root?.unmount();
    });
    const after = calls;
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(after);
    host.remove();
  });
});
