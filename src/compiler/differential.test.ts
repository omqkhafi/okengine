import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { compileAot } from "./aot.ts";
import { compileDynamic } from "./dynamic.ts";
import { encodeFailure, encodeSuccess } from "./response.ts";

/** Deterministic PRNG for reproducible contracts. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedContract {
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly schema: z.ZodType;
  readonly handler: (...args: never[]) => unknown;
  readonly samples: ReadonlyArray<{
    readonly label: string;
    readonly url: string;
    readonly init?: RequestInit;
    readonly params: Record<string, string>;
  }>;
}

function generateContracts(count: number, seed = 42): GeneratedContract[] {
  const rand = mulberry32(seed);
  const contracts: GeneratedContract[] = [];

  for (let i = 0; i < count; i++) {
    const kind = rand();
    if (kind < 0.35) {
      // POST object body
      const minSeats = 1 + Math.floor(rand() * 3);
      const schema = z.object({
        flightId: z.string().min(1),
        seats: z.number().int().min(minSeats).max(9),
        cabin: z.enum(["economy", "business"]).optional(),
      });
      const path = `/c${i}/bookings`;
      contracts.push({
        name: `post-${i}`,
        method: "POST",
        path,
        schema,
        handler: ((input: { flightId: string; seats: number; cabin?: string }) => ({
          ok: true,
          flightId: input.flightId,
          seats: input.seats,
          cabin: input.cabin ?? "economy",
        })) as never,
        samples: [
          {
            label: "valid",
            url: `http://localhost${path}?ref=diff`,
            init: {
              method: "POST",
              body: JSON.stringify({
                flightId: `F${i}`,
                seats: minSeats,
                cabin: "economy",
              }),
              headers: {
                "content-type": "application/json",
                cookie: "a=1",
              },
            },
            params: {},
          },
          {
            label: "invalid-seats",
            url: `http://localhost${path}`,
            init: {
              method: "POST",
              body: JSON.stringify({ flightId: `F${i}`, seats: 0 }),
              headers: { "content-type": "application/json" },
            },
            params: {},
          },
          {
            label: "missing-flight",
            url: `http://localhost${path}`,
            init: {
              method: "POST",
              body: JSON.stringify({ seats: minSeats }),
              headers: { "content-type": "application/json" },
            },
            params: {},
          },
        ],
      });
    } else if (kind < 0.7) {
      // GET with path param
      const schema = z.object({ id: z.string().min(1) });
      const path = `/c${i}/notes/:id`;
      const id = `n_${i}`;
      contracts.push({
        name: `get-${i}`,
        method: "GET",
        path,
        schema,
        handler: ((input: { id: string }) => ({ id: input.id, title: "t" })) as never,
        samples: [
          {
            label: "valid",
            url: `http://localhost/c${i}/notes/${id}`,
            init: { method: "GET" },
            params: { id },
          },
          {
            label: "empty-id",
            url: `http://localhost/c${i}/notes/`,
            init: { method: "GET" },
            params: { id: "" },
          },
        ],
      });
    } else {
      // POST nested + array
      const schema = z.object({
        tags: z.array(z.string().min(1)).min(1).max(5),
        meta: z.object({
          source: z.string(),
          n: z.number().int().nonnegative(),
        }),
      });
      const path = `/c${i}/tags`;
      contracts.push({
        name: `nested-${i}`,
        method: "POST",
        path,
        schema,
        handler: ((input: { tags: string[]; meta: { source: string; n: number } }) => ({
          count: input.tags.length,
          source: input.meta.source,
          n: input.meta.n,
        })) as never,
        samples: [
          {
            label: "valid",
            url: `http://localhost${path}`,
            init: {
              method: "POST",
              body: JSON.stringify({
                tags: ["a", "b"],
                meta: { source: "diff", n: i },
              }),
              headers: { "content-type": "application/json" },
            },
            params: {},
          },
          {
            label: "empty-tags",
            url: `http://localhost${path}`,
            init: {
              method: "POST",
              body: JSON.stringify({
                tags: [],
                meta: { source: "diff", n: 0 },
              }),
              headers: { "content-type": "application/json" },
            },
            params: {},
          },
        ],
      });
    }
  }

  return contracts;
}

async function runSample(
  parseValidate: (
    request: Request,
    params: Readonly<Record<string, string>>,
  ) => Promise<
    { ok: true; input: unknown } | { ok: false; failure: import("../kernel/errors.ts").FlowFailure }
  >,
  handler: (...args: never[]) => unknown,
  sample: GeneratedContract["samples"][number],
): Promise<{ status: number; body: string }> {
  const request = new Request(sample.url, sample.init);
  const parsed = await parseValidate(request, sample.params);
  if (!parsed.ok) {
    const res = encodeFailure(parsed.failure);
    return { status: res.status, body: await res.text() };
  }
  const output = handler(parsed.input as never);
  const res = encodeSuccess(output);
  return { status: res.status, body: await res.text() };
}

describe("differential — AoT ≡ dynamic across 50 contracts", () => {
  test("byte-identical responses for all samples", async () => {
    const contracts = generateContracts(50);
    expect(contracts).toHaveLength(50);

    let compared = 0;
    for (const contract of contracts) {
      const aot = compileAot({
        method: contract.method,
        path: contract.path,
        handler: contract.handler,
        schema: contract.schema,
      });
      const dyn = compileDynamic({
        method: contract.method,
        path: contract.path,
        handler: contract.handler,
        schema: contract.schema,
      });
      expect(aot.aot).toBe(true);
      expect(dyn.aot).toBe(false);

      for (const sample of contract.samples) {
        const a = await runSample(aot.parseValidate, contract.handler, sample);
        const b = await runSample(dyn.parseValidate, contract.handler, sample);
        expect(a.status).toBe(b.status);
        expect(a.body).toBe(b.body);
        compared += 1;
      }
    }

    expect(compared).toBeGreaterThanOrEqual(100);
  });
});
