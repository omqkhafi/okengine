import { z } from "zod";

/** Liveness payload for `GET /health`. */
export const HealthOut = z.object({
  ok: z.literal(true),
});

/** First-run welcome for `GET /`. */
export const RootOut = HealthOut.extend({
  app: z.string(),
  try: z.array(z.string()),
  console: z.string(),
});
