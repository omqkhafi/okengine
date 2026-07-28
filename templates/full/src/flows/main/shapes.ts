import { z } from "zod";

export const NewPing = z.object({ note: z.string().min(1).max(120) });
export const PingId = z.object({ id: z.string() });
export const Ping = z.object({
  id: z.string(),
  note: z.string(),
  createdAt: z.number(),
});
export const Health = z.object({ ok: z.literal(true) });
export const EchoIn = z.object({ text: z.string().min(1) });
export const EchoOut = z.object({ ok: z.boolean(), echo: z.string() });
