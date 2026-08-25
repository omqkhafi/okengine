import { store, field } from "okengine";

/**
 * Notes domain — abstract declarations, emitted to
 * `src/db/schema.drizzle.ts` for the active dialect by `oke db` / `oke dev`.
 */
export const notes = store.schema.table("notes", {
  id: field.id().primaryKey(),
  title: field.text().notNull(),
  body: field.text().notNull(),
  archivedAt: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
});
