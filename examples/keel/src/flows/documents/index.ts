import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, documentSummaryPrompt, member, openaiKey } from "@/core";
import { documents } from "@/db/schema.decl";
import { IdIn, IdOut, NotFound, Unavailable } from "@/lib/shapes";
import { bindNamedTableCrud } from "@/lib/resource";

const DocumentIn = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  parentKind: z.string().min(1),
  parentId: z.string().min(1),
});

const bound = bindNamedTableCrud({
  unit: "documents",
  path: "/documents",
  table: documents,
  read: [member],
  write: [member],
});

export const list = bound.list;
export const get = bound.get;
export const update = bound.update;
export const remove = bound.remove;

/** Upsert a document (featured create). */
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

/** Duplicate a document. */
export const duplicate = on(
  http.post("/documents/:id/duplicate").gate(member),
  flow("documents.duplicate", {
    in: IdIn,
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(documents, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const id = fx.id();
      await fx.store(db).insert(documents).values({
        id,
        title: `${String(row.title)} (copy)`,
        body: String(row.body),
        parentKind: String(row.parentKind),
        parentId: String(row.parentId),
      });
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
