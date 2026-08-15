import { on, flow, http, every, fail } from "okengine";
import { eq, isNull } from "drizzle-orm";

import { db, files, noteCreatedMail, notesMutate, webhookSecret } from "@/core";
import { notes } from "@/db/schema.decl";
import {
  NoteAttachIn,
  NoteAttachOut,
  NoteCreateIn,
  NoteDigestOut,
  NoteIdIn,
  NoteListOut,
  NoteOut,
  NoteSummarizeIn,
  NoteSummarizeOut,
  NotFound,
  Unavailable,
} from "./shapes";
import { noteCreated } from "./signals";

import "./shapes";
import "./signals";

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

/** List active (non-archived) notes, newest first. */
export const list = on(
  http.get("/notes").gate.public,
  flow("notes.list", {
    out: NoteListOut,
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      const data = [...rows]
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        .map((r) => ({
          id: String(r.id),
          title: String(r.title),
          body: String(r.body),
          archivedAt: r.archivedAt == null ? null : Number(r.archivedAt),
          createdAt: Number(r.createdAt),
        }));
      return fx.json.withQuery(data, input);
    },
  }),
);

/** Create a note, emit `note-created`, touch vault. */
export const create = on(
  http.post("/notes").gate(notesMutate),
  flow("notes.create", {
    in: NoteCreateIn,
    out: NoteOut,
    do: async (input, fx) => {
      // Prove Vault is wired (local: env/dev fallback).
      await fx.vault.get(webhookSecret);
      const id = fx.id();
      const createdAt = fx.clock.now();
      await fx.store(db).insert(notes).values({
        id,
        title: input.title,
        body: input.body,
        archivedAt: null,
        createdAt,
      });
      await fx.emit(noteCreated, { id, title: input.title }, { key: id });
      return {
        id,
        title: input.title,
        body: input.body,
        archivedAt: null,
        createdAt,
      };
    },
  }),
);

/** Fetch one note by id. */
export const get = on(
  http.get("/notes/:id").gate.public,
  flow("notes.get", {
    in: NoteIdIn,
    out: NoteOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      return {
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
        createdAt: Number(row.createdAt),
      };
    },
  }),
);

/** Soft-archive a note. */
export const archive = on(
  http.post("/notes/:id/archive").gate(notesMutate),
  flow("notes.archive", {
    in: NoteIdIn,
    out: NoteOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const archivedAt = fx.clock.now();
      await fx
        .store(db)
        .update(notes)
        .set({ archivedAt })
        .where(eq(notes.id, input.id));
      return {
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        archivedAt,
        createdAt: Number(row.createdAt),
      };
    },
  }),
);

/** On create → send the note-created email template. */
export const onCreated = on(
  noteCreated,
  flow("notes.onCreated", {
    do: async (payload, fx) => {
      await fx.send(noteCreatedMail, {
        to: "you@localhost",
        data: { id: payload.id, title: payload.title },
      });
    },
  }),
);

/** Store a text attachment next to a note (`files:uploads`). */
export const attach = on(
  http.post("/notes/:id/attach").gate(notesMutate),
  flow("notes.attach", {
    in: NoteAttachIn,
    out: NoteAttachOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const key = `notes/${input.id}/attachment.txt`;
      await fx.store(files).put(key, input.text);
      return { key, bytes: new TextEncoder().encode(input.text).byteLength };
    },
  }),
);

/** Daily count of active notes (frozen under test drivers). */
export const digest = on(
  every("1d"),
  flow("notes.digest", {
    out: NoteDigestOut,
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      return { active: rows.length, at: fx.clock.now() };
    },
  }),
);

/**
 * Summarize a note via the prompt's declared recovery chain.
 * Exhausted / failed asks surface as Unavailable — never a body excerpt.
 */
export const summarize = on(
  http.post("/notes/:id/summarize").gate(notesMutate),
  flow("notes.summarize", {
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
