import { field, store } from "okengine";

import { tasks } from "./tasks.ts";

/** Task ↔ follower join. */
export const taskFollowers = store.schema.table("task_followers", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  followerEmail: field.text().notNull(),
});
