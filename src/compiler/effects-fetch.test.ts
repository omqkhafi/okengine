/**
 * fx.fetch is a distinct effect kind — capability / Manifest honesty.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";
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
    expect(inferred.bareIrreversible).toEqual(["fetch"]);
  });

  test("fx.fetch inside fx.step is not a bare irreversible call", () => {
    const stepBody = {
      type: "ArrowFunctionExpression",
      params: [],
      body: {
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
              arguments: [{ type: "Literal", value: "https://example.com/data" }],
            },
          },
        ],
      },
    };
    const inferred = inferEffects({
      doNode: {
        type: "ArrowFunctionExpression",
        params: [
          { type: "Identifier", name: "_input" },
          { type: "Identifier", name: "fx" },
        ],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "ExpressionStatement",
              expression: {
                type: "CallExpression",
                callee: {
                  type: "MemberExpression",
                  object: { type: "Identifier", name: "fx" },
                  property: { type: "Identifier", name: "step" },
                  computed: false,
                },
                arguments: [{ type: "Literal", value: "load" }, stepBody],
              },
            },
          ],
        },
      } as AstNode,
      bindings: new Map<string, InferBinding>(),
      hasExplicitEffects: false,
    });
    expect(inferred.bareIrreversible).toEqual([]);
    expect(inferred.steps).toEqual(["load"]);
    expect(inferred.effects.fetches).toEqual(["example.com"]);
  });
});

describe("extract — durable fx.fetch outside fx.step", () => {
  test("OKE1901 when a durable flow calls fx.fetch directly", async () => {
    await expect(
      extractFromSources({
        "src/flows/load.ts": `
import { flow, on, http } from "okengine";
export const load = on(http.get("/load"), flow("load", {
  durable: true,
  do: async (_input, fx) => {
    return fx.fetch("https://example.com/data");
  },
}));
`,
      }),
    ).rejects.toThrow(/OKE1901/);
  });
});
