import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../manifest/types.ts";
import { manifestToNavTree } from "./Navigator.tsx";

describe("manifestToNavTree", () => {
  test("builds element sections from a Manifest", () => {
    const manifest = {
      oke: "1.0",
      app: "demo",
      flows: { hello: {} },
      signals: { ping: {} },
      stores: {},
      ai: { models: { m1: {} }, prompts: {}, agents: {} },
    } as unknown as Manifest;
    const tree = manifestToNavTree(manifest);
    expect(tree.some((n) => n.label.includes("app: demo"))).toBe(true);
    const flows = tree.find((n) => n.id === "flows");
    expect(flows?.children?.some((c) => c.label === "hello")).toBe(true);
    const ai = tree.find((n) => n.id === "ai");
    expect(ai?.children?.some((c) => c.id === "ai.models")).toBe(true);
  });
});
