/**
 * `http.resource(path, ops).gate(...).live()` — same chain as `http.get`.
 */

import { describe, expect, test } from "bun:test";
import { gate } from "../elements/gate.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { listBindings, on, resetBindings } from "./on.ts";
import { http, type HttpTrigger } from "./triggers.ts";

const member = gate.policy("member", ({ auth }) => !!auth.verified);

function bag() {
  return {
    list: flow("list", { do: () => [] }),
    create: flow("create", { do: () => ({ id: "n1" }) }),
    get: flow("get", { do: () => ({ id: "n1" }) }),
    update: flow("update", { do: () => ({ id: "n1" }) }),
    remove: flow("remove", { do: () => undefined }),
  };
}

function httpOf(path: string, method: string): HttpTrigger | undefined {
  const hit = listBindings().find((b) => {
    const t = b.trigger;
    return t.kind === "http" && t.path === path && t.method === method;
  });
  return hit?.trigger.kind === "http" ? hit.trigger : undefined;
}

describe("http.resource — gate / live", () => {
  test("bare mount has no gates and is not live", () => {
    resetBindings();
    resetFlowSeq();
    on(http.resource("/notes", bag()));
    const list = httpOf("/notes", "GET");
    expect(list?.gates).toEqual([]);
    expect(list?.isLive).toBe(false);
    expect(httpOf("/notes", "POST")?.isLive).toBe(false);
  });

  test(".gate(member).live() stamps every verb; live is GET only", () => {
    resetBindings();
    resetFlowSeq();
    on(http.resource("/notes", bag()).gate(member).live());

    const list = httpOf("/notes", "GET");
    const create = httpOf("/notes", "POST");
    const get = httpOf("/notes/:id", "GET");
    const update = httpOf("/notes/:id", "PATCH");
    const remove = httpOf("/notes/:id", "DELETE");

    expect(list?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual(["member"]);
    expect(create?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual(["member"]);
    expect(get?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual(["member"]);
    expect(update?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual(["member"]);
    expect(remove?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual(["member"]);

    expect(list?.isLive).toBe(true);
    expect(get?.isLive).toBe(true);
    expect(create?.isLive).toBe(false);
    expect(update?.isLive).toBe(false);
    expect(remove?.isLive).toBe(false);
  });

  test(".public().live() stamps the sentinel on every verb", () => {
    resetBindings();
    resetFlowSeq();
    on(http.resource("/notes", bag()).public().live());
    expect(httpOf("/notes", "GET")?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual([
      "public",
    ]);
    expect(httpOf("/notes", "POST")?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual([
      "public",
    ]);
    expect(httpOf("/notes", "GET")?.isLive).toBe(true);
    expect(httpOf("/notes", "POST")?.isLive).toBe(false);
  });

  test(".live().gate(member) order does not matter", () => {
    resetBindings();
    resetFlowSeq();
    on(http.resource("/notes", bag()).live().gate(member));
    expect(httpOf("/notes", "GET")?.isLive).toBe(true);
    expect(httpOf("/notes", "GET")?.gates.map((g) => (typeof g === "string" ? g : g.name))).toEqual(
      ["member"],
    );
  });
});
