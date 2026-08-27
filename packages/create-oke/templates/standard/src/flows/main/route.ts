import { on, flow, http } from "okengine/http";
import { z } from "zod";

/** First-run welcome — visit :6530/ after `oke dev` (browser code block; curl stays JSON). */
export const root = on(
  http.get().public(),
  flow({
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
