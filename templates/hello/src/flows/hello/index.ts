import { on, flow, http } from "okengine";
import { z } from "zod";

/** First-run welcome — visit :6530/ after `oke dev`. */
export const root = on(
  http.get("/"),
  flow({
    out: z.object({
      ok: z.literal(true),
      console: z.string(),
      try: z.string(),
    }),
    do: () => ({
      ok: true as const,
      console: "http://127.0.0.1:6533",
      try: "/hello",
    }),
  }),
);

export const hello = on(
  http.get("/hello"),
  flow({
    out: z.object({ message: z.string() }),
    do: () => ({ message: "ok" }),
  }),
);
