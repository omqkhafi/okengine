import { store, field, id, now } from "okengine";

/**
 * Domain schema — abstract declarations, emitted to
 * `src/schema.generated.ts` for the active dialect (sqlite in local mode,
 * postgres in docker) by `oke db` / `oke dev`.
 */
export const entries = store.schema.table("entries", {
  id: field.text().primaryKey().defaultFn(id),
  body: field.text().notNull(),
  createdAt: field.integer().notNull().defaultFn(now),
});
