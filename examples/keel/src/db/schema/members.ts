import { field, store } from "okengine";

import { spaces } from "./spaces.ts";

/** Space members. */
export const members = store.schema.table("members", {
  id: field.id().primaryKey(),
  spaceId: field.text().references(() => spaces.id, { onDelete: "set null" }),
  name: field.text().notNull(),
  email: field.text().notNull().pii(),
  role: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});
