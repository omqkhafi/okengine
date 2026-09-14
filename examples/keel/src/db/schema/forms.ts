import { field, store } from "okengine";

import { projects } from "./projects.ts";

/** Intake forms on a project. */
export const forms = store.schema.table("forms", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  schemaJson: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});
