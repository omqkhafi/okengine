import { z } from "zod";

export const Health = z.object({ ok: z.literal(true) });
