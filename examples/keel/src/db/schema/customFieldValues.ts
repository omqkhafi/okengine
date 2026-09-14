import { field, store } from "okengine";

import { customFields } from "./customFields.ts";
import { tasks } from "./tasks.ts";

/** Custom field value on a task. */
export const customFieldValues = store.schema.table("custom_field_values", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  fieldId: field
    .text()
    .notNull()
    .references(() => customFields.id, { onDelete: "cascade" }),
  value: field.text().notNull(),
});
