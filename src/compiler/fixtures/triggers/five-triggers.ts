/**
 * All five trigger kinds — effects inferred through `fx` for each.
 */
import { on, flow, http, internal, signal, store, clock, field } from "okengine";

export const db = store.sql("db");
export const orders = store.schema.table("orders", {
  id: field.text().primaryKey(),
  status: field.text(),
});
export const links = store.schema.table("links", {
  code: field.text().primaryKey(),
  clicks: field.integer(),
  createdAt: field.integer(),
});

export const linkClicked = signal.once("link-clicked", { retries: 3, deadLetter: true });

// ① HTTP
export const create = on(
  http.post("/orders"),
  flow("triggers.http", {
    do: async (input, fx) => {
      await fx.store(db).insert(orders).values(input);
      return { ok: true };
    },
  }),
);

// ② CLOCK / every
export const cleanup = clock("cleanup", { every: "10m" });
on(
  cleanup,
  flow("triggers.every", {
    do: (_, fx) => fx.store(db).delete(links).where({ createdAt: 0 }),
  }),
);

// ③ SIGNAL
on(
  linkClicked,
  flow("triggers.signal", {
    do: async ({ code }, fx) => {
      const clicks = await fx.store(db).increment(links, code, "clicks");
      await fx.emit(linkClicked, { code, clicks });
    },
  }),
);

// ④ CDC
on(
  db.table(orders).changed("status"),
  flow("triggers.cdc", {
    do: ({ before, after }, fx) => fx.store(db).insert(orders).values({ before, after }),
  }),
);

// ⑤ INTERNAL / call-only
export const stats = on(
  internal,
  flow("triggers.internal", {
    do: async ({ code }, fx) => {
      const [row] = await fx.store(db).select().from(links).where({ code });
      return row?.clicks ?? 0;
    },
  }),
);
