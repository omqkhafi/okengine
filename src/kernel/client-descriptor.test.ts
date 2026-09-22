/**
 * Client descriptor printing — schema type strings are cached per object.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AnyFlowDef } from "./flow.ts";
import type { RuntimeRouteMap } from "./adopt-routes.ts";
import { buildClientDescriptor } from "./client-descriptor.ts";

const FLOW_COUNT = 64;

function fieldSchema() {
  return z.object({
    id: z.string().uuid(),
    title: z.string().min(1).max(120),
    tags: z.array(z.string()),
    count: z.number().int().nonnegative(),
  });
}

function fixture(): {
  routes: RuntimeRouteMap;
  flows: Map<string, AnyFlowDef>;
} {
  const routes: RuntimeRouteMap = { app: {} };
  const flows = new Map<string, AnyFlowDef>();
  for (let i = 0; i < FLOW_COUNT; i++) {
    const name = `flow${i}`;
    routes.app![name] = { method: "GET", path: `/${name}` };
    flows.set(`app.${name}`, {
      in: fieldSchema(),
      out: z.object({
        id: z.string(),
        title: z.string(),
        createdAt: z.iso.datetime(),
      }),
    } as AnyFlowDef);
  }
  return { routes, flows };
}

describe("schemaToTsString cache", () => {
  test("a second pass over the same schema objects skips reprinting them", () => {
    const { routes, flows } = fixture();

    const coldStart = performance.now();
    const cold = buildClientDescriptor(routes, flows);
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    const warm = buildClientDescriptor(routes, flows);
    const warmMs = performance.now() - warmStart;

    expect(warm).toEqual(cold);
    expect(cold.routes.app?.flow0?.in).toContain("title");
    // Uncached toJSONSchema is the whole map. A cache hit is the map lookup.
    expect(warmMs).toBeLessThan(coldMs / 4);
    console.log(
      `client descriptor ${FLOW_COUNT} flows cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms`,
    );

    const previous = flows.get("app.flow0");
    flows.set("app.flow0", {
      in: z.object({ id: z.string(), extra: z.boolean() }),
      out: previous?.out,
    } as AnyFlowDef);

    const touchedStart = performance.now();
    const touched = buildClientDescriptor(routes, flows);
    const touchedMs = performance.now() - touchedStart;

    expect(touched.routes.app?.flow0?.in).toContain("extra");
    expect(touched.routes.app?.flow1?.in).toBe(warm.routes.app?.flow1?.in);
    expect(touchedMs).toBeLessThan(coldMs / 4);
    console.log(`client descriptor one schema replaced=${touchedMs.toFixed(1)}ms`);
  });
});
