import { field, store } from "okengine";

import { goals } from "./goals.ts";
import { spaces } from "./spaces.ts";

/** Projects inside a space, optionally tied to a goal. */
export const projects = store.schema.table("projects", {
  id: field.id().primaryKey(),
  spaceId: field
    .text()
    .notNull()
    .references(() => spaces.id),
  goalId: field.text().references(() => goals.id, { onDelete: "set null" }),
  name: field.text().notNull(),
  status: field.text().notNull(),
  leadEmail: field.text().pii(),
  startDate: field.timestamp(),
  targetDate: field.timestamp(),
  color: field.text(),
  createdAt: field.timestamp().notNull().now(),
  updatedAt: field.timestamp().notNull().now(),
});
