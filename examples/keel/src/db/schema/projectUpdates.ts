import { field, store } from "okengine";

import { projects } from "./projects.ts";

/** Status updates on a project. */
export const projectUpdates = store.schema.table("project_updates", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  health: field.text().notNull(),
  body: field.text().notNull(),
  authorEmail: field.text().pii(),
  createdAt: field.timestamp().notNull().now(),
});
