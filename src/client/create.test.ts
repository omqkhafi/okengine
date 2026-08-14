/**
 * Typed client — same-repo `<App>`, narrowing, transport behaviours.
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "./create.ts";
import { isErrorCode, isOk, isTransportError } from "./errors.ts";
import type { AppOf, ClientError, ClientResult } from "./types.ts";

/** Fixture App matching Notes / bookings (`FlightFull`). */
type BookingsApp = AppOf<{
  bookings: {
    create: {
      in: { flightId: string; seats: number };
      out: { id: string; flightId: string; seats: number };
      errors: { FlightFull: { seatsLeft: number } };
    };
  };
  notes: {
    get: {
      in: { id: string };
      out: { id: string; title: string };
      errors: { NotFound: Record<string, never> };
    };
  };
}>;

/** Compile-time equality. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

describe("createClient — same-repo <App>", () => {
  test("success envelope is typed", async () => {
    const api = createClient<BookingsApp>("http://app.test", {
      fetch: async () =>
        Response.json({
          data: { id: "b_1", flightId: "SK1", seats: 1 },
          error: null,
        }),
    });

    const result = await api.bookings.create({
      flightId: "SK1",
      seats: 1,
    });
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("b_1");
    expect(isOk(result)).toBe(true);
  });

  test('error.code === "FlightFull" narrows error.data', async () => {
    const api = createClient<BookingsApp>("http://app.test", {
      fetch: async () =>
        Response.json(
          {
            data: null,
            error: { code: "FlightFull", data: { seatsLeft: 2 } },
          },
          { status: 400 },
        ),
    });

    const { data, error } = await api.bookings.create({
      flightId: "SK1",
      seats: 9,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("FlightFull");

    if (error?.code === "FlightFull") {
      // Runtime + type-level: seatsLeft is number, not unknown.
      expect(error.data.seatsLeft).toBe(2);
      type _Narrow = Assert<Eq<typeof error.data, { seatsLeft: number }>>;
      const _keep: _Narrow = true;
      expect(_keep).toBe(true);
    } else {
      throw new Error("expected FlightFull");
    }

    expect(isErrorCode(error, "FlightFull")).toBe(true);
    if (isErrorCode(error, "FlightFull")) {
      expect(error.data.seatsLeft).toBe(2);
    }
  });

  test("RPC path is POST /_oke/{unit}/{flow}", async () => {
    let seen = "";
    const api = createClient<BookingsApp>("http://app.test/", {
      fetch: async (input) => {
        seen = String(input);
        return Response.json({
          data: { id: "n_1", title: "Hi" },
          error: null,
        });
      },
    });
    await api.notes.get({ id: "n_1" });
    expect(seen).toBe("http://app.test/_oke/notes/get");
  });

  test("REST routes map substitutes path params", async () => {
    let method = "";
    let url = "";
    const api = createClient<BookingsApp>("http://app.test", {
      routes: {
        "notes.get": { method: "GET", path: "/notes/:id" },
      },
      fetch: async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "GET");
        return Response.json({
          data: { id: "n_1", title: "Hi" },
          error: null,
        });
      },
    });
    await api.notes.get({ id: "n_1" });
    expect(method).toBe("GET");
    expect(url).toBe("http://app.test/notes/n_1");
  });

  test("REST QUERY always sends a JSON body and Content-Type", async () => {
    type SearchApp = AppOf<{
      search: {
        run: {
          in: { id: string; q?: string };
          out: { n: number };
          errors: Record<string, never>;
        };
      };
    }>;
    let method = "";
    let url = "";
    let body: string | undefined;
    let contentType: string | null = null;
    const api = createClient<SearchApp>("http://app.test", {
      routes: {
        "search.run": { method: "QUERY", path: "/search/:id" },
      },
      fetch: async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "");
        body = typeof init?.body === "string" ? init.body : undefined;
        contentType = new Headers(init?.headers).get("content-type");
        return Response.json({ data: { n: 1 }, error: null });
      },
    });
    await api.search.run({ id: "x" });
    expect(method).toBe("QUERY");
    expect(url).toBe("http://app.test/search/x");
    expect(body).toBe("{}");
    expect(contentType ?? "").toContain("application/json");

    await api.search.run({ id: "x", q: "ali" });
    expect(body).toBe('{"q":"ali"}');
  });
});

describe("createClient — type helpers", () => {
  test("ClientError discriminated union is exhaustive on code", () => {
    type E = ClientError<{
      FlightFull: { seatsLeft: number };
      NotFound: Record<string, never>;
    }>;
    type _Codes = Assert<Eq<E["code"], "FlightFull" | "NotFound">>;
    const ok: _Codes = true;
    expect(ok).toBe(true);

    const sample: ClientResult<{ id: string }, { FlightFull: { seatsLeft: number } }> = {
      data: null,
      error: { code: "FlightFull", data: { seatsLeft: 0 } },
    };
    if (sample.error?.code === "FlightFull") {
      type _D = Assert<Eq<typeof sample.error.data, { seatsLeft: number }>>;
      const d: _D = true;
      expect(d).toBe(true);
    }
  });

  test("isTransportError", () => {
    expect(
      isTransportError({
        code: "TransportError",
        data: { message: "boom" },
      }),
    ).toBe(true);
    expect(isTransportError({ code: "FlightFull", data: {} })).toBe(false);
  });
});
