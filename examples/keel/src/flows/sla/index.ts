import { on, flow, every } from "okengine";

import { db, slaAlertMail } from "@/core";
import { issues } from "@/db/schema.decl";
import { slaBreaching } from "./signals";

import "./signals";

/** Scan issue SLA high-risk / breached. */
export const watch = on(
  every("15m"),
  flow("sla.watch", {
    plane: "operator",
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(issues);
      const now = fx.clock.now();
      for (const row of rows) {
        if (row.archivedAt != null || row.slaBreachesAt == null) continue;
        const at = Date.parse(String(row.slaBreachesAt));
        if (!Number.isFinite(at) || at > now) continue;
        const payload = {
          id: String(row.id),
          identifier: String(row.identifier),
          title: String(row.title),
        };
        await fx.emit(slaBreaching, payload);
        await fx.send(slaAlertMail, {
          to: String(row.assigneeEmail ?? "ops@keel.dev"),
          data: payload,
        });
      }
    },
  }),
);
