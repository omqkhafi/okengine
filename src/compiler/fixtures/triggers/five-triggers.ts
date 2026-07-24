/**
 * All five trigger kinds — effects inferred through `fx` for each.
 */
import { on, flow, http, every, internal, table, signal, store } from "okengine";

export const db = store.sql("db");
export const orders = { name: "orders" };
export const links = { name: "links" };

export const linkClicked = signal("link-clicked", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
});

// ① HTTP
export const create = on(
  http.post("/orders"),
  flow({
    name: "triggers.http",
    do: async (input, fx) => {
      await fx.store(db).insert(orders).values(input);
      return { ok: true };
    },
  }),
);

// ② CLOCK / every
on(
  every("10m"),
  flow({
    name: "triggers.every",
    do: (_, fx) => fx.store(db).deleteExpired(links, "30d"),
  }),
);

// ③ SIGNAL
on(
  linkClicked,
  flow({
    name: "triggers.signal",
    do: async ({ code }, fx) => {
      const clicks = await fx.store(db).increment(links, code, "clicks");
      await fx.emit(linkClicked, { code, clicks });
    },
  }),
);

// ④ CDC
on(
  table("orders").changed("status"),
  flow({
    name: "triggers.cdc",
    do: ({ before, after }, fx) =>
      fx.store(db).insert(orders).values({ before, after }),
  }),
);

// ⑤ INTERNAL / call-only
export const stats = on(
  internal,
  flow({
    name: "triggers.internal",
    do: ({ code }, fx) => fx.store(db).getClicks(links, code),
  }),
);
