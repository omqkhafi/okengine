import { on, flow, every } from "okengine";
import { eq } from "drizzle-orm";

import { db } from "@/core";
import { recurrence, spaces, tasks } from "@/db/schema.decl";
import { create as createTask } from "@/flows/tasks/index";

/** Spawn due recurring tasks — named clock `spawn-recurring`. */
export const spawn = on(
  every("1h"),
  flow("recurring.spawn", {
    plane: "operator",
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(recurrence);
      const now = fx.clock.now();
      const spaceRows = await fx.store(db).select().from(spaces);
      for (const rule of rows) {
        const nextAt = Date.parse(String(rule.nextAt));
        if (!Number.isFinite(nextAt) || nextAt > now) continue;
        const source = await fx.store(db).findById(tasks, String(rule.taskId));
        if (!source) continue;
        const space = spaceRows.find((s) => String(s.id) === String(source.spaceId));
        await fx.call(createTask, {
          title: String(source.title),
          spaceKey: space ? String(space.key) : "ENG",
          description: source.description == null ? undefined : String(source.description),
          projectId: source.projectId == null ? undefined : String(source.projectId),
          priority: Number(source.priority),
        });
        const everyMs = String(rule.every) === "7d" ? 7 * 86_400_000 : 86_400_000;
        const next = new Date(now + everyMs).toISOString();
        await fx
          .store(db)
          .update(recurrence)
          .set({ nextAt: next })
          .where(eq(recurrence.id, String(rule.id)));
      }
    },
  }),
);
