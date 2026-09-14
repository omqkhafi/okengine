import { field, store } from "okengine";

import { projects } from "./projects.ts";
import { sections } from "./sections.ts";
import { spaces } from "./spaces.ts";

/** Work items inside a space / project / section. */
export const tasks = store.schema.table("tasks", {
  id: field.id().primaryKey(),
  identifier: field.text().notNull().unique(),
  title: field.text().notNull(),
  description: field.text(),
  kind: field.text().notNull(),
  priority: field.integer().notNull(),
  estimate: field.integer(),
  status: field.text().notNull(),
  spaceId: field
    .text()
    .notNull()
    .references(() => spaces.id),
  projectId: field.text().references(() => projects.id, { onDelete: "set null" }),
  sectionId: field.text().references(() => sections.id, { onDelete: "set null" }),
  parentId: field.text(),
  startDate: field.timestamp(),
  dueDate: field.timestamp(),
  completedAt: field.timestamp(),
  archivedAt: field.timestamp(),
  creatorEmail: field.text().pii(),
  roleNeeded: field.text(),
  createdAt: field.timestamp().notNull().now(),
  updatedAt: field.timestamp().notNull().now(),
});
