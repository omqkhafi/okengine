/**
 * Writer flows that only DML must not infer effects.embeds.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

describe("hybrid search — writer effect isolation", () => {
  test("insert-only flow has no embeds effect", async () => {
    const source = `
import { on, flow, http, store, field, ai } from "okengine";

export const embedder = ai.model("embedder", { provider: "openai-compatible", model: "nomic-embed-text" });

export const articles = store.schema.table("articles", {
  id: field.text().primaryKey(),
  body: field.text().searchable().embed({ dims: 8, model: embedder }),
});
export const db = store.sql("app", { schema: { articles } });

export const create = on(
  http.post("/articles"),
  flow("articles.create", {
    do: async (input, fx) => {
      await fx.store(db).insert(articles).values(input);
      return { ok: true };
    },
  }),
);
`;
    const manifest = await extractFromSources({
      "src/schema.decl.ts": source,
      "src/flows/articles.ts": source,
    });
    const effects = manifest.flows?.["articles.create"]?.effects;
    expect(effects?.embeds).toBeUndefined();
    expect(effects?.asks).toBeUndefined();
    expect(effects?.writes).toContain("sql:articles");
  });
});
