import { on, flow, http, every, gate, fail } from "okengine";
import { eq, isNull } from "drizzle-orm";

import { db, files, noteCreatedMail, webhookSecret } from "@/core";
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
} from "./shapes";
import { noteCreated } from "./signals";

import "./shapes";
import "./signals";

/** List active (non-archived) notes, newest first. */
export const list = on(
  http.get("/notes").gate(gate.public),
  flow("notes.list", {
    out: NoteListOut,
    effects: { reads: ["sql:app"] },
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      const sorted = [...rows].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
      return {
        notes: sorted.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          body: String(r.body),
          archivedAt: r.archivedAt == null ? null : Number(r.archivedAt),
          createdAt: Number(r.createdAt),
        })),
      };
    },
  }),
);

/** Create a note, emit `note-created`, touch vault. */
export const create = on(
  http.post("/notes").gate(gate.public),
  flow("notes.create", {
    in: NoteCreateIn,
    out: NoteOut,
    effects: {
      writes: ["sql:app"],
      emits: ["note-created"],
      secrets: ["APP_WEBHOOK_SECRET"],
    },
    do: async (input, fx) => {
      // Prove Vault is wired (local: env/dev fallback).
      fx.vault(webhookSecret);
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
  http.get("/notes/:id").gate(gate.public),
  flow("notes.get", {
    in: NoteIdIn,
    out: NoteOut,
    errors: { NotFound },
    effects: { reads: ["sql:app"] },
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
  http.post("/notes/:id/archive").gate(gate.public),
  flow("notes.archive", {
    in: NoteIdIn,
    out: NoteOut,
    errors: { NotFound },
    effects: { reads: ["sql:app"], writes: ["sql:app"] },
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
    effects: { sends: ["note-created"] },
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
  http.post("/notes/:id/attach").gate(gate.public),
  flow("notes.attach", {
    in: NoteAttachIn,
    out: NoteAttachOut,
    errors: { NotFound },
    effects: { reads: ["sql:app"], writes: ["files:uploads"] },
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
    effects: { reads: ["sql:app"] },
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      return { active: rows.length, at: fx.clock.now() };
    },
  }),
);

/**
 * Summarize a note via AI when configured (`oke ai setup` / create-oke --ai).
 * Without an AI runtime, returns a local fallback excerpt.
 */
export const summarize = on(
  http.post("/notes/:id/summarize").gate(gate.public),
  flow("notes.summarize", {
    in: NoteSummarizeIn,
    out: NoteSummarizeOut,
    errors: { NotFound },
    effects: { reads: ["sql:app"], asks: ["summarize-note"] },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const body = String(row.body);
      try {
        const out = await fx.ask("summarize-note", {
          title: String(row.title),
          body,
        });
        const summary =
          typeof out === "object" && out !== null && "summary" in out
            ? String((out as { summary: unknown }).summary)
            : JSON.stringify(out);
        return { id: input.id, summary, via: "ai" as const };
      } catch {
        const summary = body.length > 160 ? `${body.slice(0, 157)}…` : body;
        return { id: input.id, summary, via: "fallback" as const };
      }
    },
  }),
);
