import { field, store } from "okengine";

/** Labels that tasks can wear. */
export const tags = store.schema.table("tags", {
  id: field.id().primaryKey(),
  name: field.text().notNull(),
  groupName: field.text(),
});
