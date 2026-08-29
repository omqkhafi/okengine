import { on, flow } from "okengine";
import { z } from "zod";

import { db, member, projectAdminWrite, rollupGoalsClock, weeklySummaryPrompt } from "@/core";
import { goals, projects } from "@/db/schema.decl";
import { goalsZod } from "@/db/zod";
import { bindCrud } from "@/lib/resource";
import { goalAtRisk, goalChanged, goalHealth } from "./signals";

import "./signals";

const createIn = z.object({
  name: z.string().min(1),
  status: z.string().optional(),
  ownerEmail: z.string().optional(),
  targetDate: z.string().optional(),
});

export const { list, create, get, update, remove } = bindCrud({
  unit: "goals",
  path: "/goals",
  table: goals,
  read: member,
  write: projectAdminWrite,
  createIn,
  out: goalsZod.select,
  defaults: { status: "active" },
  search: ["name", "status"],
});

/** Weekly goal rollup — named clock `rollup-goals`. */
export const rollup = on(
  rollupGoalsClock,
  flow("goals.rollup", {
    plane: "operator",
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(goals);
      const atRisk = rows.filter((r) => String(r.status) === "at_risk");
      let summary = `${atRisk.length} goals at risk`;
      try {
        const out = await fx.ask(weeklySummaryPrompt, { atRisk: atRisk.length });
        if (out && typeof out === "object" && "summary" in out) {
          summary = String((out as { summary: unknown }).summary);
        }
      } catch {
        // mock / missing model
      }
      void summary;
      await fx.store(db).select().from(projects);
      for (const goal of atRisk) {
        const payload = {
          goalId: String(goal.id),
          name: String(goal.name),
          status: String(goal.status),
        };
        await fx.emit(goalAtRisk, payload, { key: payload.goalId });
        await fx.emit(goalChanged, payload);
        await fx.emit(goalHealth, payload);
      }
    },
  }),
);
