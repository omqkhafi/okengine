import { on, flow, http, fail } from "okengine";
import { eq, isNull } from "drizzle-orm";

import { db, noteCreatedMail, notesMutate, webhookSecret } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteCreateIn, NoteIdIn, NoteListOut, NoteOut, NotFound } from "./shapes";
import { noteCreated } from "./signals";

import "./shapes";
import "./signals";

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
