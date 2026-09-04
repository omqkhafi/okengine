/**
 * fx.embed is a distinct effect kind from fx.ask — capability / Manifest honesty.
 */

import { describe, expect, test } from "bun:test";
import { parseSync } from "oxc-parser";
import { inferEffects, type AstNode, type InferBinding } from "./effects-infer.ts";

function doNodeFrom(source: string): AstNode {
  const wrapped = `const __fn = ${source}`;
  const result = parseSync("t.ts", wrapped);
  const program = result.program as AstNode & { body: AstNode[] };
  const decl = program.body[0] as AstNode & {
    declarations: Array<{ init: AstNode }>;
  };
  return decl.declarations[0]!.init;
}

describe("inferEffects — fx.embed ≠ fx.ask", () => {
  test("fx.embed alone → effects.embeds, never asks", () => {
    const doNode = doNodeFrom(`async (_input, fx) => {
      return fx.embed("embedder", "hello");
    }`);
    const bindings = new Map<string, InferBinding>([
      ["embedder", { kind: "unknown", ref: "embedder" }],
    ]);
    const inferred = inferEffects({ doNode, bindings, hasExplicitEffects: false });
    expect(inferred.effects.embeds).toEqual(["embedder"]);
    expect(inferred.effects.asks).toBeUndefined();
    expect(inferred.nondeterministic).toBe(true);
  });

  test("fx.ask alone → effects.asks, never embeds", () => {
    const doNode = doNodeFrom(`async (_input, fx) => {
      return fx.ask("triage", { q: "x" });
    }`);
    const bindings = new Map<string, InferBinding>([
      ["triage", { kind: "prompt", ref: "triage" }],
    ]);
    const inferred = inferEffects({ doNode, bindings, hasExplicitEffects: false });
    expect(inferred.effects.asks).toEqual(["triage"]);
    expect(inferred.effects.embeds).toBeUndefined();
  });

  test("both ask and embed keep separate bags", () => {
    const doNode = doNodeFrom(`async (_input, fx) => {
      await fx.embed("embedder", "t");
      return fx.ask("rerank", { query: "q", docs: [] });
    }`);
    const inferred = inferEffects({
      doNode,
      bindings: new Map(),
      hasExplicitEffects: false,
    });
    expect(inferred.effects.embeds).toEqual(["embedder"]);
    expect(inferred.effects.asks).toEqual(["rerank"]);
  });
});
