import { store, field, id, now } from "okengine";

/**
 * Notes domain — abstract declarations, emitted to
 * `src/schema.generated.ts` for the active dialect by `oke db` / `oke dev`.
 */
export const notes = store.schema.table("notes", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  body: field.text().notNull(),
  archivedAt: field.integer(),
  createdAt: field.integer().notNull().defaultFn(now),
});
