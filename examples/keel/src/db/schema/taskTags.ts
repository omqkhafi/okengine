import { field, store } from "okengine";

import { tags } from "./tags.ts";
import { tasks } from "./tasks.ts";

/** Task ↔ tag join. */
export const taskTags = store.schema.table("task_tags", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  tagId: field
    .text()
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
});
