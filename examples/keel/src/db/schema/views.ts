import { field, store } from "okengine";

import { projects } from "./projects.ts";

/** Saved views (filters / layout) on a project. */
export const views = store.schema.table("views", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  kind: field.text().notNull(),
  filtersJson: field.text(),
  ownerEmail: field.text().pii(),
  createdAt: field.timestamp().notNull().now(),
});
