import { store, field } from "okengine";

/**
 * Notes domain — abstract declarations, emitted to
 * `src/db/schema.drizzle.ts` for the active dialect by `oke db` / `oke dev`.
 *
 * `.searchable()` is free BM25. With `oke ai setup` (embed model chosen),
 * body also gets bare `.embed()` and `oke({ store: { search: { embed } } })`
 * stamps the project default (model + dims).
 */
export const notes = store.schema.table("notes", {
  id: field.id().primaryKey(),
  title: field.text().searchable({ weight: 2 }).notNull(),
  body: field.text().searchable().notNull(),
  archivedAt: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
});
