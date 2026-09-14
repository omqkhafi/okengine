import { field, store } from "okengine";

import { tasks } from "./tasks.ts";

/** Task blocks another task. */
export const taskDependencies = store.schema.table("task_dependencies", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  blocksTaskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
});
