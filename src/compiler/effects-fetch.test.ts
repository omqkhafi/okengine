/**
 * fx.fetch is a distinct effect kind — capability / Manifest honesty.
 */

import { describe, expect, test } from "bun:test";
import { inferEffects, type AstNode, type InferBinding } from "./effects-infer.ts";

function parseDo(src: string): AstNode {
  // Minimal CallExpression-shaped tree for fx.fetch("https://…")
  const match = /fx\.fetch\(\s*"([^"]+)"/.exec(src);
  if (!match) throw new Error(`no fx.fetch in ${src}`);
  return {
    type: "BlockStatement",
    body: [
      {
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: {
            type: "MemberExpression",
            object: { type: "Identifier", name: "fx" },
            property: { type: "Identifier", name: "fetch" },
            computed: false,
          },
          arguments: [{ type: "Literal", value: match[1] }],
        },
      },
    ],
  } as AstNode;
}

describe("inferEffects — fx.fetch → effects.fetches", () => {
  test("fx.fetch URL literal → host in fetches", () => {
    const inferred = inferEffects({
      doNode: parseDo(`async (fx) => { await fx.fetch("https://api.stripe.com/v1"); }`),
      bindings: new Map<string, InferBinding>(),
      hasExplicitEffects: false,
    });
    expect(inferred.effects.fetches).toEqual(["api.stripe.com"]);
    expect(inferred.effects.calls).toBeUndefined();
    expect(inferred.effects.sends).toBeUndefined();
  });
});
