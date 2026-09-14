import { field, store } from "okengine";

import { forms } from "./forms.ts";
import { tasks } from "./tasks.ts";

/** One form response, optionally turned into a task. */
export const formSubmissions = store.schema.table("form_submissions", {
  id: field.id().primaryKey(),
  formId: field
    .text()
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  taskId: field.text().references(() => tasks.id, { onDelete: "set null" }),
  payloadJson: field.text().notNull(),
  customerName: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});
