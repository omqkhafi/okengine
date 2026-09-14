import { field, store } from "okengine";

import { projects } from "./projects.ts";

/** Ordered sections inside a project. */
export const sections = store.schema.table("sections", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  sortOrder: field.integer().notNull(),
});
