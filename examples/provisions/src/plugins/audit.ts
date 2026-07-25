import { plugin, store } from "okengine";
import { z } from "zod";

export const audit = plugin("audit", { version: "1.0.0" })
  .config(z.object({ retain: z.string().default("2y") }))
  .element(store.sql("audit", { schema: () => import("./audit-schema") }))
  .needs("store.kv")
  .decorate("audit", { enabled: true })
  .hook("afterHandle", async (ctx, fx) => {
    if (ctx.trigger.meta?.audit) await fx.store("audit").log(ctx);
  })
  .errors({ AuditWriteFailed: z.object({ reason: z.string() }) })
  .consolePanel({ id: "audit", title: "Audit Trail", entry: "./panel.tsx" })
  .cli("audit:export", ({ fx }) => fx.store("audit").exportCsv());
