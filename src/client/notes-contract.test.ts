/**
 * Notes contract — `typeof app` → typed client (Prompt 8.1).
 *
 * Proves: adopt accumulates routes · REST from trigger · error narrowing ·
 * removing a flow from adopt removes it from the client type.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { resetSignals, signal } from "../elements/signal/declare.ts";
import { createClient } from "./create.ts";
import type { Client } from "./types.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
  resetSignals();
});

/** Compile-time equality. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const NoteId = z.object({ id: z.string() });
const Note = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});
const NewNote = z.object({
  title: z.string(),
  body: z.string(),
});
const NotFound = z.object({});

const create = on(
  http.post("/notes"),
  flow("notes.create", {
    in: NewNote,
    out: NoteId,
    do: (input) => ({ id: `n_${input.title}` }),
  }),
);

const get = on(
  http.get("/notes/:id"),
  flow("notes.get", {
    in: NoteId,
    out: Note,
    errors: { NotFound },
    do: ({ id }, fx) =>
      id === "missing" ? fx.fail("NotFound", {}) : { id, title: "First", body: "Hello" },
  }),
);

const notes = { create, get } as const;

describe("Notes — typeof app carries contracts", () => {
  test("four-applications client block typechecks without AppOf<>", () => {
    const app = oke({ name: "notes" }).adopt({ notes });
    type App = typeof app;

    // Exactly the Notes client shape — types from App alone, no AppOf.
    const api = createClient<App>("http://localhost:6530");

    type GetResult = Awaited<ReturnType<typeof api.notes.get>>;
    type GetError = NonNullable<GetResult["error"]>;
    type NotFoundData = Extract<GetError, { code: "NotFound" }>["data"];
    type SuccessTitle = Extract<GetResult, { error: null }>["data"]["title"];

    type _Err = Assert<Eq<NotFoundData, Record<string, never>>>;
    type _Title = Assert<Eq<SuccessTitle, string>>;
    const ok: [_Err, _Title] = [true, true];
    expect(ok).toEqual([true, true]);
    expect(typeof api.notes.get).toBe("function");
    expect(typeof api.notes.create).toBe("function");
  });

  test("Notes client block: createClient<App> narrows data and NotFound", async () => {
    const app = oke({ name: "notes" }).adopt({ notes });
    type App = typeof app;

    // four-applications client shape — App from typeof app, no AppOf<>.
    const api = createClient<App>("http://localhost:6530", {
      $routes: app.$routes,
      fetch: async (input, init) => {
        const url = String(input);
        const method = String(init?.method ?? "GET");
        if (method === "GET" && url.endsWith("/notes/n_1")) {
          return Response.json({
            data: { id: "n_1", title: "First", body: "Hello" },
            error: null,
          });
        }
        if (method === "GET" && url.endsWith("/notes/missing")) {
          return Response.json(
            { data: null, error: { code: "NotFound", data: {} } },
            { status: 404 },
          );
        }
        return Response.json(
          {
            data: null,
            error: {
              code: "TransportError",
              data: { message: `${method} ${url}` },
            },
          },
          { status: 500 },
        );
      },
    });

    {
      const { data, error } = await api.notes.get({ id: "n_1" });
      if (error?.code === "NotFound") {
        type _Empty = Assert<Eq<typeof error.data, Record<string, never>>>;
        const keep: _Empty = true;
        expect(keep).toBe(true);
        throw new Error("unexpected NotFound");
      } else if (error) {
        throw new Error(`unexpected ${error.code}`);
      } else {
        // Notes: else data.title — narrowed success
        expect(data.title).toBe("First");
        type _Title = Assert<Eq<typeof data.title, string>>;
        const t: _Title = true;
        expect(t).toBe(true);
      }
    }

    {
      const { error } = await api.notes.get({ id: "missing" });
      if (error?.code === "NotFound") {
        type _D = Assert<Eq<typeof error.data, Record<string, never>>>;
        const d: _D = true;
        expect(d).toBe(true);
      } else {
        throw new Error("expected NotFound");
      }
    }
  });

  test("api.notes.get issues GET /notes/n_1, not RPC POST", async () => {
    const app = oke({ name: "notes" }).adopt({ notes });
    type App = typeof app;

    let method = "";
    let url = "";
    const api = createClient<App>("http://app.test", {
      $routes: app.$routes,
      fetch: async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "GET");
        return Response.json({
          data: { id: "n_1", title: "First", body: "Hello" },
          error: null,
        });
      },
    });

    await api.notes.get({ id: "n_1" });
    expect(method).toBe("GET");
    expect(url).toBe("http://app.test/notes/n_1");
  });

  test("createClient(app, url) wires REST from app.$routes", async () => {
    const app = oke({ name: "notes" }).adopt({ notes });

    let method = "";
    let url = "";
    const api = createClient(app, "http://app.test", {
      fetch: async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "GET");
        return Response.json({
          data: { id: "n_1", title: "Hi", body: "" },
          error: null,
        });
      },
    });

    await api.notes.get({ id: "n_1" });
    expect(method).toBe("GET");
    expect(url).toBe("http://app.test/notes/n_1");
  });

  test("POST create uses REST /notes from trigger", async () => {
    const app = oke({ name: "notes" }).adopt({ notes });
    let method = "";
    let url = "";
    let body = "";
    const api = createClient(app, "http://app.test", {
      fetch: async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "GET");
        body = String(init?.body ?? "");
        return Response.json({ data: { id: "n_1" }, error: null });
      },
    });

    await api.notes.create({ title: "First", body: "Hello" });
    expect(method).toBe("POST");
    expect(url).toBe("http://app.test/notes");
    expect(JSON.parse(body)).toEqual({ title: "First", body: "Hello" });
  });

  test("runtime $routes carries method/path literals from triggers", () => {
    const app = oke({ name: "notes" }).adopt({ notes });
    expect(app.$routes.notes.get).toEqual({
      method: "GET",
      path: "/notes/:id",
    });
    expect(app.$routes.notes.create).toEqual({
      method: "POST",
      path: "/notes",
    });

    type App = typeof app;
    type GetMethod = App["$routes"]["notes"]["get"]["method"];
    type GetPath = App["$routes"]["notes"]["get"]["path"];
    type _M = Assert<Eq<GetMethod, "GET">>;
    type _P = Assert<Eq<GetPath, "/notes/:id">>;
    const ok: [_M, _P] = [true, true];
    expect(ok).toEqual([true, true]);
  });

  test("removing a flow from adopt removes it from the client type", () => {
    const full = oke({ name: "notes" }).adopt({ notes });
    const createOnly = oke({ name: "notes" }).adopt({
      notes: { create: notes.create },
    });

    type FullClient = Client<typeof full>;
    type PartialClient = Client<typeof createOnly>;

    type FullHasGet = "get" extends keyof FullClient["notes"] ? true : false;
    type PartialHasGet = "get" extends keyof PartialClient["notes"] ? true : false;

    type _Full = Assert<Eq<FullHasGet, true>>;
    type _Part = Assert<Eq<PartialHasGet, false>>;
    const checks: [_Full, _Part] = [true, true];
    expect(checks).toEqual([true, true]);

    // Runtime table matches.
    expect("get" in full.$routes.notes).toBe(true);
    expect("get" in createOnly.$routes.notes).toBe(false);
  });

  test("untriggered adopted flow is RPC-only on the client", async () => {
    const stats = flow("notes.stats", {
      in: NoteId,
      out: z.object({ clicks: z.number() }),
      do: () => ({ clicks: 7 }),
    });

    const app = oke({ name: "notes" }).adopt({
      notes: { create, get, stats },
    });

    expect(app.$routes.notes.stats).toEqual({});

    let url = "";
    let method = "";
    const api = createClient(app, "http://app.test", {
      fetch: async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "GET");
        return Response.json({ data: { clicks: 7 }, error: null });
      },
    });

    await api.notes.stats({ id: "n_1" });
    expect(method).toBe("POST");
    expect(url).toBe("http://app.test/_oke/notes/stats");
  });

  test("typeof app live exposure is subscribe, not JSON RPC", () => {
    const orderStatus = signal("order-status", {
      delivery: "live",
      optional: true,
      schema: z.object({ orderId: z.string(), status: z.string() }),
    });
    const events = on(http.get("/orders/:orderId/events").live(orderStatus));
    const app = oke({ name: "shop", autoBoot: false, registry: "ignore" }).adopt({
      orders: { events },
    });

    type LiveFlag = typeof app.$routes.orders.events extends { readonly live: string }
      ? true
      : false;
    type StreamFlag = typeof app.$routes.orders.events extends { readonly stream: true }
      ? true
      : false;
    type _Live = Assert<Eq<LiveFlag, true>>;
    type _Stream = Assert<Eq<StreamFlag, true>>;
    const flags: [_Live, _Stream] = [true, true];
    expect(flags).toEqual([true, true]);
    expect(app.$routes.orders.events.live).toBe("order-status");
    expect(app.$routes.orders.events.stream).toBe(true);

    const api = createClient(app, "http://app.test", {
      fetch: async () =>
        new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const stop = api.orders.events({ orderId: "ord_1" }, { onEvent: () => undefined });
    type _Unsub = Assert<Eq<typeof stop, () => void>>;
    const unsub: _Unsub = true;
    expect(unsub).toBe(true);
    expect(typeof stop).toBe("function");
    stop();
  });
});
