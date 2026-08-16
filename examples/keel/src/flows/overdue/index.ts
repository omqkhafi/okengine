import { on, flow, every } from "okengine";

import { db, taskOverdueMail } from "@/core";
import { inbox, taskAssignees, tasks } from "@/db/schema.decl";

/** Scan overdue tasks — named clock `watch-overdue`. */
export const watch = on(
  every("15m"),
  flow("overdue.watch", {
    plane: "operator",
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(tasks);
      const assignees = await fx.store(db).select().from(taskAssignees);
      const now = fx.clock.now();
      for (const row of rows) {
        if (row.archivedAt != null || row.completedAt != null || row.dueDate == null) continue;
        const at = Date.parse(String(row.dueDate));
        if (!Number.isFinite(at) || at > now) continue;
        const email =
          assignees.find((a) => String(a.taskId) === String(row.id))?.assigneeEmail ??
          "ops@keel.dev";
        const payload = {
          id: String(row.id),
          identifier: String(row.identifier),
          title: String(row.title),
        };
        await fx.send(taskOverdueMail, { to: String(email), data: payload });
        await fx.store(db).insert(inbox).values({
          id: fx.id(),
          memberEmail: String(email),
          kind: "overdue",
          title: payload.title,
          refId: payload.id,
          readAt: null,
          createdAt: now,
        });
      }
    },
  }),
);
