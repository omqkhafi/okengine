import { field, store } from "okengine";

import { tasks } from "./tasks.ts";

/** Comments on a task. */
export const comments = store.schema.table("comments", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  authorEmail: field.text().pii(),
  body: field.text().notNull(),
  resolvedAt: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
});
