/**
 * Flow `out` projection — store rows through ISO `out` without DTO mappers.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { isJsonResult } from "./fx.ts";
import { on, resetBindings } from "./on.ts";
import { projectFlowOut } from "./project-out.ts";
import { http } from "./triggers.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const IsoInstant = z.iso.datetime();

const LinkOut = z.object({
  id: z.string(),
  clicks: z.number(),
  expiresAt: IsoInstant.nullable(),
  createdAt: IsoInstant,
});

describe("projectFlowOut", () => {
  test("JSON-wires Date timestamps onto iso.datetime out", async () => {
    const createdAt = new Date("2026-09-14T12:00:00.000Z");
    const projected = await projectFlowOut(LinkOut, {
      id: "lnk_1",
      clicks: 0,
      expiresAt: null,
      createdAt,
      extra: "drop-me",
    });
    expect(projected).toEqual({
      id: "lnk_1",
      clicks: 0,
      expiresAt: null,
      createdAt: "2026-09-14T12:00:00.000Z",
    });
  });

  test("JSON-wires fx.clock.now()-style epoch-ms *At onto iso.datetime out", async () => {
    const createdAt = Date.parse("2026-09-14T12:00:00.000Z");
    const projected = await projectFlowOut(LinkOut, {
      id: "lnk_1",
      clicks: 0,
      expiresAt: null,
      createdAt,
    });
    expect(projected).toEqual({
      id: "lnk_1",
      clicks: 0,
      expiresAt: null,
      createdAt: "2026-09-14T12:00:00.000Z",
    });
  });

  test("fx.json.create carrier projects .value and keeps 201", async () => {
    const createdAt = new Date("2026-09-14T12:00:00.000Z");
    const fx = (await import("./fx.ts")).createFx({ flow: "links.create" });
    const carrier = await projectFlowOut(
      LinkOut,
      fx.json.create({
        id: "lnk_1",
        clicks: 0,
        expiresAt: null,
        createdAt,
      }),
    );
    expect(isJsonResult(carrier)).toBe(true);
    if (!isJsonResult(carrier)) return;
    expect(carrier.status).toBe(201);
    expect(carrier.value).toEqual({
      id: "lnk_1",
      clicks: 0,
      expiresAt: null,
      createdAt: "2026-09-14T12:00:00.000Z",
    });
  });

  test("z.date() out keeps Date (direct parse, no wire)", async () => {
    const createdAt = new Date("2026-09-14T12:00:00.000Z");
    const Out = z.object({ createdAt: z.date() });
    const projected = await projectFlowOut(Out, { createdAt });
    expect(projected).toEqual({ createdAt });
    expect((projected as { createdAt: Date }).createdAt).toBe(createdAt);
  });

  test("array out projects each row", async () => {
    const createdAt = new Date("2026-09-14T12:00:00.000Z");
    const projected = await projectFlowOut(z.array(LinkOut), [
      { id: "lnk_1", clicks: 1, expiresAt: null, createdAt },
    ]);
    expect(projected).toEqual([
      { id: "lnk_1", clicks: 1, expiresAt: null, createdAt: "2026-09-14T12:00:00.000Z" },
    ]);
  });

  test("bigint integers JSON-wire onto z.number()", async () => {
    const Out = z.object({ clicks: z.number() });
    const projected = await projectFlowOut(Out, { clicks: 3n });
    expect(projected).toEqual({ clicks: 3 });
  });

  test("missing out is a no-op", async () => {
    const row = { id: "lnk_1", createdAt: new Date() };
    expect(await projectFlowOut(undefined, row)).toBe(row);
  });
});

describe("execute — out projects fx.json.create(row)", () => {
  test("in-process create returns ISO timestamps from a Date row", async () => {
    resetBindings();
    resetFlowSeq();
    const createdAt = new Date("2026-09-14T12:00:00.000Z");
    on(
      http.post("/links", { out: LinkOut }).public(),
      flow("links.create", {
        do: (_input, fx) =>
          fx.json.create({
            id: "lnk_1",
            clicks: 0,
            expiresAt: null,
            createdAt,
            secret: "not-on-the-wire",
          }),
      }),
    );
    const app = oke({ name: "project-out", env: "test" });
    await app.boot({ env: "test" });
    const flowDef = app.flow("links.create")!;
    const result = await app.execute(flowDef, {}, flowDef.triggers[0]!);
    expect(result.failure).toBeUndefined();
    expect(isJsonResult(result.output)).toBe(true);
    if (!isJsonResult(result.output)) return;
    expect(result.output.status).toBe(201);
    expect(result.output.value).toEqual({
      id: "lnk_1",
      clicks: 0,
      expiresAt: null,
      createdAt: "2026-09-14T12:00:00.000Z",
    });
    await app.bootResult?.close();
  });

  test("withQuery page projects Date rows onto array out", async () => {
    resetBindings();
    resetFlowSeq();
    const createdAt = new Date("2026-09-14T12:00:00.000Z");
    on(
      http.get("/links", { out: z.array(LinkOut) }).public(),
      flow("links.list", {
        do: (input, fx) =>
          fx.json.withQuery(
            [{ id: "lnk_1", clicks: 0, expiresAt: null, createdAt, extra: true }],
            input,
          ),
      }),
    );
    const app = oke({ name: "project-out-list", env: "test" });
    await app.boot({ env: "test" });
    const flowDef = app.flow("links.list")!;
    const result = await app.execute(flowDef, { limit: 10 }, flowDef.triggers[0]!);
    expect(result.failure).toBeUndefined();
    expect(isJsonResult(result.output)).toBe(true);
    if (!isJsonResult(result.output)) return;
    expect(result.output.value).toEqual([
      { id: "lnk_1", clicks: 0, expiresAt: null, createdAt: "2026-09-14T12:00:00.000Z" },
    ]);
    await app.bootResult?.close();
  });
});
