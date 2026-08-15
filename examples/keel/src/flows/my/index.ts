import { on, flow, http } from "okengine";

import { db, member, plannerAgent } from "@/core";
import { taskAssignees, tasks } from "@/db/schema.decl";
import { listIn, pageOut, queryPage } from "@/lib/http";
import { TaskOut } from "@/flows/tasks/shapes";

/** My Tasks — assigned to the caller, not completed. */
export const tasksMine = on(
  http.get("/me/tasks").gate(member).live(),
  flow("my.tasks", {
    in: listIn({ mode: "offset" }),
    out: pageOut(TaskOut),
    do: async (input, fx) => {
      const email = fx.auth.userId ?? "";
      const assignees = await fx.store(db).select().from(taskAssignees);
      const mine = new Set(
        assignees.filter((a) => String(a.assigneeEmail) === email).map((a) => String(a.taskId)),
      );
      const rows = await fx.store(db).select().from(tasks);
      const items = rows
        .filter((r) => mine.has(String(r.id)) && r.completedAt == null && r.archivedAt == null)
        .map((r) =>
          TaskOut.parse({
            id: String(r.id),
            identifier: String(r.identifier),
            title: String(r.title),
            description: r.description == null ? null : String(r.description),
            kind: String(r.kind ?? "task"),
            priority: Number(r.priority),
            estimate: r.estimate == null ? null : Number(r.estimate),
            status: String(r.status),
            spaceId: String(r.spaceId),
            projectId: r.projectId == null ? null : String(r.projectId),
            sectionId: r.sectionId == null ? null : String(r.sectionId),
            parentId: r.parentId == null ? null : String(r.parentId),
            dueDate: r.dueDate == null ? null : String(r.dueDate),
            completedAt: r.completedAt == null ? null : String(r.completedAt),
            archivedAt: r.archivedAt == null ? null : String(r.archivedAt),
            roleNeeded: r.roleNeeded == null ? null : String(r.roleNeeded),
          }),
        );
      return fx.json.with(
        queryPage(items, input, { mode: "offset", search: ["title", "identifier"] }),
      );
    },
  }),
);

/** Run the planner agent on the caller's inbox. */
export const plan = on(
  http.post("/me/plan").gate(member),
  flow("my.plan", {
    do: async (_input, fx) => {
      const email = fx.auth.userId ?? "ops@keel.dev";
      return await fx.run(plannerAgent, {
        message: `Plan today's work for ${email}`,
      });
    },
  }),
);
