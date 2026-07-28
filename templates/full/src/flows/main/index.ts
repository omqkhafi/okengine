import { on, flow, http, every } from "okengine";
import { lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../core";
import { burst, cheap, exact, fair } from "../../gates";
import { appSecret } from "../../vault";
import { pingNotice } from "../../channels";
import { echo as echoPrompt } from "../../ai";
import { pings } from "../../schema";
import { EchoIn, EchoOut, Health, NewPing, Ping, PingId } from "./shapes";
import { pinged } from "./signals";

/** First-run welcome — visit :6530/ after `oke dev`. */
export const root = on(
  http.get("/").gate(fair),
  flow({
    name: "main.root",
    out: z.object({
      ok: z.literal(true),
      console: z.string(),
      try: z.string(),
    }),
    do: () => ({
      ok: true as const,
      console: "http://127.0.0.1:6533",
      try: "POST /pings  {\"note\":\"hello\"}  ·  POST /echo  {\"text\":\"hi\"}",
    }),
  }),
);

/** Liveness — shared default rate gate. */
export const health = on(
  http.get("/health").gate(fair),
  flow({
    name: "main.health",
    out: Health,
    do: () => ({ ok: true as const }),
  }),
);

/**
 * The one real write — inserts a row, reads Vault, emits `pinged`.
 * Replace this unit with your domain; keep the wiring pattern.
 */
export const create = on(
  http.post("/pings").gate(fair, exact, burst),
  flow({
    name: "main.create",
    in: NewPing,
    out: PingId,
    do: async (input, fx) => {
      void fx.vault(appSecret);
      const [row] = await fx.store(db).insert(pings).values(input).returning();
      await fx.emit(pinged, { id: row.id, note: row.note, at: Date.now() });
      return { id: row.id };
    },
  }),
);

/** The one real read — list stored pings. */
export const list = on(
  http.get("/pings").gate(fair, cheap),
  flow({
    name: "main.list",
    out: Ping.array(),
    do: (_input, fx) => fx.store(db).select().from(pings),
  }),
);

/**
 * AI — callable from the Console Flows panel (`main.echo`) or HTTP.
 * Uses `ai.model("mock")` so first boot needs no API keys.
 */
export const echo = on(
  http.post("/echo").gate(fair, burst),
  flow({
    name: "main.echo",
    in: EchoIn,
    out: EchoOut,
    do: (input, fx) => fx.ask(echoPrompt, input),
  }),
);

/** Signal consumer — same species as HTTP; sends a channel notice. */
on(
  pinged,
  flow({
    name: "main.onPinged",
    do: async ({ id, note }, fx) => {
      await fx.send(pingNotice, {
        to: "dev@localhost",
        data: { id, note },
      });
    },
  }),
);

/** Cron — touches the same table (prune rows older than 7 days). */
on(
  every("1h"),
  flow({
    name: "main.prune",
    do: (_input, fx) => {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return fx.store(db).delete(pings).where(lt(pings.createdAt, cutoff));
    },
  }),
);
