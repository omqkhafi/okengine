import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

/**
 * Docs collection — `source` points at the canonical markdown in the monorepo
 * (Edit on GitHub links there, not at the generated content file).
 */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend({
      source: z.string().optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {},
});
