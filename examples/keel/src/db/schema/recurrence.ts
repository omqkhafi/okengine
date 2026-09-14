import { field, store } from "okengine";

import { tasks } from "./tasks.ts";

/** Recurring schedule attached to a task. */
export const recurrence = store.schema.table("recurrence", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  every: field.text().notNull(),
  nextAt: field.timestamp().notNull(),
});
