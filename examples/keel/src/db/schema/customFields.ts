import { field, store } from "okengine";

import { projects } from "./projects.ts";

/** Project-scoped custom field definitions. */
export const customFields = store.schema.table("custom_fields", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  type: field.text().notNull(),
});
