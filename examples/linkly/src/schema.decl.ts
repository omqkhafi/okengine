import { store, field } from "okengine";

/** Short links — `code` is the human-facing unique key. */
export const links = store.schema.table("links", {
  id: field.text().primaryKey(), // `increment` targets this column
  code: field.text().notNull().unique(), // the short, human-facing key
  url: field.text().notNull(),
  userId: field.text().notNull(),
  clicks: field.integer().notNull().default(0),
  createdAt: field.integer().notNull(),
});

/** Per-link daily click counts — FK to `links.code`. */
export const daily = store.schema.table("daily", {
  id: field.text().primaryKey(),
  code: field
    .text()
    .notNull()
    .references(() => links.code),
  day: field.text().notNull(), // "YYYY-MM-DD"
  clicks: field.integer().notNull().default(0),
});

/** links ↔ daily — one link has many daily rows. */
export const relations = store.schema.relations({ links, daily }, (r) => ({
  links: {
    daily: r.many.daily({
      from: r.links.code,
      to: r.daily.code,
    }),
  },
  daily: {
    link: r.one.links({
      from: r.daily.code,
      to: r.links.code,
      optional: false,
    }),
  },
}));
