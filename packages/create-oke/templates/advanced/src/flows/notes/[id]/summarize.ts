import { on, flow, http, fail } from "okengine/http";

import { db, notesMutate } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteSummarizeIn, NoteSummarizeOut, NotFound, Unavailable } from "../shapes";

/**
 * Pull a usable summary string from an `fx.ask` payload.
 *
 * @param out - Model output object
 */
function extractSummary(out: unknown): string {
  if (typeof out === "string") return unwrapSummaryText(out);
  if (!out || typeof out !== "object") return "";
  const record = out as Record<string, unknown>;
  if (typeof record.summary === "string") return record.summary.trim();
  if (typeof record.text === "string") return unwrapSummaryText(record.text);
  return "";
}

/**
 * Local models sometimes return over-escaped JSON (`{\\"summary\\":...}`).
 * Peel one or two JSON layers, then fall back to the raw text.
 *
 * @param text - Model text payload
 */
function unwrapSummaryText(text: string): string {
  let current = text.trim();
  for (let i = 0; i < 2; i++) {
    if (!(current.startsWith("{") || current.startsWith('"'))) break;
    try {
      const parsed = JSON.parse(current) as unknown;
      if (typeof parsed === "string") {
        current = parsed.trim();
        continue;
      }
      if (parsed && typeof parsed === "object" && "summary" in parsed) {
        return String((parsed as { summary: unknown }).summary).trim();
      }
      break;
    } catch {
      break;
    }
  }
  return current;
}

/**
 * Summarize a note via the prompt's declared recovery chain.
 * Exhausted / failed asks surface as Unavailable — never a body excerpt.
 */
export const summarize = on(
  http.post().gate(notesMutate),
  flow({
    in: NoteSummarizeIn,
    out: NoteSummarizeOut,
    errors: { NotFound, Unavailable },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      try {
        const out = await fx.ask("summarize-note", {
          instruction:
            'Summarize this note in one or two sentences. Reply with JSON only: {"summary":"..."}',
          title: String(row.title),
          body: String(row.body),
        });
        const summary = extractSummary(out);
        const via = typeof out.via === "string" ? out.via.trim() : "";
        if (!summary || !via) {
          return fail("Unavailable", {
            message: "AI service unavailable. Try again later.",
          });
        }
        return { id: input.id, summary, via };
      } catch {
        return fail("Unavailable", {
          message: "AI service unavailable. Try again later.",
        });
      }
    },
  }),
);
