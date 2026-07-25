import { on, flow, http } from "okengine";
import { z } from "zod";

export const hello = on(
  http.get("/hello"),
  flow({
    out: z.object({ message: z.string() }),
    do: () => ({ message: "ok" }),
  }),
);
