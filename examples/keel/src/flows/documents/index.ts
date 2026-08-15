import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, documentSummaryPrompt, member, openaiKey } from "@/core";
import { documents } from "@/db/schema.decl";
import { documentsZod } from "@/db/zod";
import { IdIn, IdOut, NotFound, Unavailable } from "@/lib/shapes";
import { bindCrud } from "@/lib/resource";

const DocumentIn = documentsZod.insert
  .pick({
    title: true,
    body: true,
    parentKind: true,
    parentId: true,
  })
  .extend({
    title: z.string().min(1),
    body: z.string().min(1),
    parentKind: z.string().min(1),
    parentId: z.string().min(1),
  });

export const { list, get, update, remove } = bindCrud({
  unit: "documents",
  path: "/documents",
  table: documents,
  read: member,
  write: member,
  createIn: DocumentIn,
  out: documentsZod.select,
  search: ["title", "body"],
  skipCreate: true,
});

/** Upsert a document. */
export const upsert = on(
  http.post("/documents").gate(member),
  flow("documents.upsert", {
    in: DocumentIn.extend({ id: z.string().optional() }),
    out: IdOut,
    do: async (input, fx) => {
      const id = input.id ?? fx.id();
      await fx.store(db).upsert(
        documents,
        { id },
        {
          id,
          title: input.title,
          body: input.body,
          parentKind: input.parentKind,
          parentId: input.parentId,
        },
      );
      return { id };
    },
  }),
);

/** Summarize via `document-summary`. */
export const summarize = on(
  http.post("/documents/:id/summarize").gate(member),
  flow("documents.summarize", {
    in: IdIn,
    out: z.object({ summary: z.string() }),
    errors: { NotFound, Unavailable },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(documents, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.vault.get(openaiKey);
      try {
        const out = await fx.ask(documentSummaryPrompt, {
          title: String(row.title),
          body: String(row.body),
        });
        const summary =
          out && typeof out === "object" && "summary" in out
            ? String((out as { summary: unknown }).summary)
            : "";
        if (!summary) {
          return fail("Unavailable", { message: "AI service unavailable. Try again later." });
        }
        return { summary };
      } catch {
        return fail("Unavailable", { message: "AI service unavailable. Try again later." });
      }
    },
  }),
);
