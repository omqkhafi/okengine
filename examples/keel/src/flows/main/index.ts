import { on, flow, http } from "okengine";
import { z } from "zod";

/** First-run welcome — visit :6530/ after `oke dev` (browser code block; curl stays JSON). */
export const root = on(
  http.get("/").public(),
  flow("main.root", {
    out: z.object({
      ok: z.literal(true),
      app: z.string(),
      try: z.array(z.string()),
      console: z.string(),
    }),
    do: () => ({
      ok: true as const,
      app: "keel",
      try: ["GET /tasks", "POST /tasks", "POST /forms/:id/submit", "GET /me/tasks", "GET /health"],
      console: "http://127.0.0.1:6533",
    }),
  }),
);

/** Liveness for probes and `bun test`. */
export const health = on(
  http.get("/health").public(),
  flow("main.health", {
    out: z.object({ ok: z.literal(true) }),
    do: () => ({ ok: true as const }),
  }),
);
