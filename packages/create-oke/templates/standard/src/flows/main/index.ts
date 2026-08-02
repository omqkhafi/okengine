import { on, flow, http, gate } from "okengine";
import { z } from "zod";

/** First-run welcome — visit :6530/ after `oke dev`. */
export const root = on(
  http.get("/").gate(gate.public),
  flow({
    name: "main.root",
    unit: "main",
    out: z.object({
      ok: z.literal(true),
      app: z.string(),
      try: z.array(z.string()),
      console: z.string(),
    }),
    do: () => ({
      ok: true as const,
      app: "notes",
      try: ["GET /notes", "POST /notes", "GET /health"],
      console: "http://127.0.0.1:6533",
    }),
  }),
);

/** Liveness for probes and `bun test`. */
export const health = on(
  http.get("/health").gate(gate.public),
  flow({
    name: "main.health",
    unit: "main",
    out: z.object({ ok: z.literal(true) }),
    do: () => ({ ok: true as const }),
  }),
);
