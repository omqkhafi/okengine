import { on, http, store } from "okengine";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { db } from "../../core";
import { notes as notesTable } from "../../schema";

// Contracts derived from the schema — one source of truth.
const NewNote = createInsertSchema(notesTable, { title: (s) => s.min(1).max(120) }).omit({
  id: true,
  createdAt: true,
});
const Note = createSelectSchema(notesTable);

// One declarative resource: list (cursor + search + filters + order +
// select), create (201), get / update / remove with typed NotFound.
const notesR = store.resource(db, notesTable, {
  in: NewNote,
  out: Note,
  update: NewNote.partial(),
  list: {
    cursor: [notesTable.createdAt, notesTable.id],
    direction: "desc",
    limit: 20,
    maxLimit: 100,
    search: [notesTable.title],
    filter: "all",
    order: "all",
  },
  unit: "notes",
  breaking: true,
});

// Mount all five verbs: list/create on /notes, get/update/remove on /notes/:id.
// `on(http.resource(...))` returns the ops bag; spread it into named exports
// so `adopt({ notes })` registers each flow under the unit.
const mounted = on(http.resource("/notes", notesR.all()));

export const list = mounted.list;
export const create = mounted.create;
export const get = mounted.get;
export const update = mounted.update;
export const remove = mounted.remove;
