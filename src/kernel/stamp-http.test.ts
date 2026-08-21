/**
 * In-place path / name stamps and fail-loud HTTP boot.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import type { RuntimeRouteMap } from "./adopt-routes.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { resetRegisteredFlowUnits, registerFlowUnits } from "./flow-units.ts";
import { listBindings, on, resetBindings } from "./on.ts";
import { stampFlowName, stampHttpPath } from "./stamp-http.ts";
import { HTTP_PATH_PENDING } from "./http-path-pending.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
  resetRegisteredFlowUnits();
});

describe("stampHttpPath", () => {
  test("mutates the on() binding in place — listBindings sees the stamped path", () => {
    const f = on(http.get().public(), flow({ do: () => ({ ok: true }) }));
    expect(f.$trigger && f.$trigger.kind === "http" && f.$trigger.path).toBe(HTTP_PATH_PENDING);
    stampHttpPath(f, "/notes/:id");
    expect(f.$trigger && f.$trigger.kind === "http" && f.$trigger.path).toBe("/notes/:id");
    const bound = listBindings()[0];
    expect(bound?.trigger.kind === "http" && bound.trigger.path).toBe("/notes/:id");
  });

  test("explicit http.get('/x') wins — stamp does not overwrite", () => {
    const f = on(http.get("/me/tasks").public(), flow("notes.get", { do: () => 1 }));
    stampHttpPath(f, "/notes/:id");
    expect(f.$trigger && f.$trigger.kind === "http" && f.$trigger.path).toBe("/me/tasks");
  });
});

describe("stampFlowName", () => {
  test("fills a nameless flow as unit.export", () => {
    const f = flow({ do: () => 1 });
    expect(f.name).toBe("");
    stampFlowName(f, "notes.get");
    expect(f.name).toBe("notes.get");
    expect(f.unit).toBe("notes");
  });

  test("explicit flow('notes.get') wins", () => {
    const f = flow("notes.get", { do: () => 1 });
    stampFlowName(f, "notes.list");
    expect(f.name).toBe("notes.get");
  });
});

describe("oke — unresolved sentinel and duplicate routes", () => {
  test("unresolved http.get() fails construction", () => {
    on(http.get().public(), flow("notes.get", { do: () => 1 }));
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1010/);
  });

  test("duplicate GET /notes fails construction", () => {
    on(http.get("/notes").public(), flow("notes.list", { do: () => 1 }));
    on(http.get("/notes").public(), flow("notes.also", { do: () => 1 }));
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1011/);
  });

  test("nameless HTTP flow fails construction", () => {
    on(http.get("/notes").public(), flow({ do: () => 1 }));
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1012/);
  });

  test("registerFlowUnits drains into $routes; registry ignore does not", () => {
    const get = on(http.get("/notes/:id").public(), flow("notes.get", { do: () => 1 }));
    registerFlowUnits({ notes: { get } });
    const ignored = oke({ name: "t", autoBoot: false, registry: "ignore" });
    expect(ignored.$routes).toEqual({});
    const app = oke({ name: "t", autoBoot: false });
    expect((app.$routes as RuntimeRouteMap).notes?.get?.path).toBe("/notes/:id");
  });
});
