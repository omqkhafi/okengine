import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { VALIDATION_ERROR_CODE } from "../validation/standard-schema.ts";
import { compileAot, sucrose } from "./aot.ts";
import { compileDynamic } from "./dynamic.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("sucrose — context inference", () => {
  test("POST enables body; path params enable params; skips unused slots", () => {
    const inference = sucrose({
      handler: ((input: { flightId: string }) => input) as never,
      path: "/bookings",
      method: "POST",
      hasSchema: true,
    });
    expect(inference.body).toBe(true);
    expect(inference.params).toBe(false);
    expect(inference.query).toBe(false);
    expect(inference.headers).toBe(false);
    expect(inference.cookie).toBe(false);
  });

  test("detects context.body / query / headers access", () => {
    const inference = sucrose({
      handler: ((ctx: {
        body: unknown;
        query: unknown;
        headers: unknown;
      }) => ({
        body: ctx.body,
        q: ctx.query,
        h: ctx.headers,
      })) as never,
      method: "GET",
      path: "/",
    });
    expect(inference.body).toBe(true);
    expect(inference.query).toBe(true);
    expect(inference.headers).toBe(true);
  });

  test("GET /:id enables params only", () => {
    const inference = sucrose({
      handler: (({ id }: { id: string }) => ({ id })) as never,
      path: "/notes/:id",
      method: "GET",
      hasSchema: true,
    });
    expect(inference.params).toBe(true);
    expect(inference.body).toBe(false);
  });
});

describe("compileAot", () => {
  test("generates aot handler that validates JSON POST", async () => {
    const schema = z.object({
      flightId: z.string().min(1),
      seats: z.number().int().min(1),
    });
    const compiled = compileAot({
      method: "POST",
      path: "/bookings",
      handler: ((input: { flightId: string; seats: number }) => input) as never,
      schema,
    });
    expect(compiled.aot).toBe(true);
    expect(compiled.inference.body).toBe(true);

    const ok = await compiled.parseValidate(
      new Request("http://localhost/bookings", {
        method: "POST",
        body: JSON.stringify({ flightId: "SK1", seats: 2 }),
        headers: { "content-type": "application/json" },
      }),
      {},
    );
    expect(ok).toEqual({
      ok: true,
      input: { flightId: "SK1", seats: 2 },
    });

    const bad = await compiled.parseValidate(
      new Request("http://localhost/bookings", {
        method: "POST",
        body: JSON.stringify({ flightId: "SK1", seats: 0 }),
      }),
      {},
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.error.code).toBe(VALIDATION_ERROR_CODE);
    }
  });

  test("dynamic path never uses new Function", () => {
    const compiled = compileDynamic({
      method: "POST",
      path: "/x",
      handler: (() => null) as never,
      schema: z.object({ n: z.number() }),
    });
    expect(compiled.aot).toBe(false);
    expect(compiled.inference.body).toBe(true);
    expect(compiled.inference.headers).toBe(true);
  });
});

describe("typed error narrowing end-to-end", () => {
  test("declared FlightFull narrows by error.code; validation is not a throw", async () => {
    const Booking = z.object({
      flightId: z.string().min(1),
      seats: z.number().int().min(1),
    });
    const FlightFull = z.object({ seatsLeft: z.number() });

    on(
      http.post("/bookings"),
      flow({
        name: "bookings.create",
        in: Booking,
        out: z.object({ id: z.string() }),
        errors: { FlightFull },
        do: (input: { flightId: string; seats: number }, fx) => {
          if (input.seats > 2) {
            return fx.fail("FlightFull", { seatsLeft: 2 });
          }
          return { id: "b_1" };
        },
      }),
    );

    const app = oke({ name: "bookings-e2e" });

    const full = await app.fetch(
      new Request("http://localhost/bookings", {
        method: "POST",
        body: JSON.stringify({ flightId: "SK1", seats: 5 }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(full.status).toBe(400);
    const fullBody = (await full.json()) as {
      data: null;
      error: { code: string; data: { seatsLeft: number } };
    };
    expect(fullBody.data).toBeNull();
    if (fullBody.error.code === "FlightFull") {
      expect(fullBody.error.data.seatsLeft).toBe(2);
    } else {
      throw new Error(`expected FlightFull, got ${fullBody.error.code}`);
    }

    const invalid = await app.fetch(
      new Request("http://localhost/bookings", {
        method: "POST",
        body: JSON.stringify({ flightId: "SK1", seats: 0 }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(invalid.status).toBe(422);
    const invalidBody = (await invalid.json()) as {
      data: null;
      error: { code: string };
    };
    expect(invalidBody.error.code).toBe(VALIDATION_ERROR_CODE);

    const ok = await app.fetch(
      new Request("http://localhost/bookings", {
        method: "POST",
        body: JSON.stringify({ flightId: "SK1", seats: 1 }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { id: "b_1" }, error: null });
  });
});

describe("AoT throughput ≥ 1.5× dynamic", () => {
  test("validated JSON POST", async () => {
    const schema = z.object({
      flightId: z.string().min(1),
      seats: z.number().int().min(1).max(9),
      note: z.string().max(200).optional(),
    });
    const handler = ((input: {
      flightId: string;
      seats: number;
    }) => input) as never;

    const aot = compileAot({
      method: "POST",
      path: "/bookings",
      handler,
      schema,
    });
    const dyn = compileDynamic({
      method: "POST",
      path: "/bookings",
      handler,
      schema,
    });
    expect(aot.aot).toBe(true);
    expect(dyn.aot).toBe(false);

    const makeReq = () =>
      new Request("http://localhost/bookings?utm=x", {
        method: "POST",
        body: JSON.stringify({ flightId: "SK1", seats: 2, note: "window" }),
        headers: {
          "content-type": "application/json",
          cookie: "sid=abc",
          "x-extra": "1",
        },
      });

    // Warmup
    for (let i = 0; i < 200; i++) {
      await aot.parseValidate(makeReq(), {});
      await dyn.parseValidate(makeReq(), {});
    }

    const iterations = 4_000;

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      await aot.parseValidate(makeReq(), {});
    }
    const aotMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      await dyn.parseValidate(makeReq(), {});
    }
    const dynMs = performance.now() - t1;

    const speedup = dynMs / aotMs;
    expect(speedup).toBeGreaterThanOrEqual(1.5);
  });
});
