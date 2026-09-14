import { field, store } from "okengine";

import { links } from "./links.ts";

/** Per-day click totals keyed by `links.code`. */
export const daily = store.schema.table("daily", {
  id: field.id().primaryKey(),
  code: field
    .text()
    .notNull()
    .references(() => links.code, { onDelete: "cascade" }),
  day: field.text().notNull(),
  clicks: field.integer().notNull().default(0),
});
