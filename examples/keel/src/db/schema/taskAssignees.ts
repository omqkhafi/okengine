import { field, store } from "okengine";

import { tasks } from "./tasks.ts";

/** Task ↔ assignee join. */
export const taskAssignees = store.schema.table("task_assignees", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  assigneeEmail: field.text().notNull(),
});
