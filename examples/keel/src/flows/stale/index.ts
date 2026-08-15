import { on, flow, every } from "okengine";

import { db, slaAlertMail } from "@/core";
import { issues } from "@/db/schema.decl";

/** Nudge issues idle past SLA warn. */
export const nudge = on(
  every("1h"),
  flow("stale.nudge", {
    plane: "operator",
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(issues);
      const now = fx.clock.now();
      for (const row of rows) {
        if (row.archivedAt != null) continue;
        const sla = row.slaBreachesAt == null ? null : Date.parse(String(row.slaBreachesAt));
        if (sla !== null && sla <= now) {
          await fx.send(slaAlertMail, {
            to: String(row.assigneeEmail ?? "ops@keel.dev"),
            data: {
              id: String(row.id),
              identifier: String(row.identifier),
              title: String(row.title),
            },
          });
        }
      }
    },
  }),
);
