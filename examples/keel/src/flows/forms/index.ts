import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, formClassifyPrompt, member, openaiKey, projectAdminWrite } from "@/core";
import { formSubmissions, forms, projects, spaces } from "@/db/schema.decl";
import { formsZod } from "@/db/zod";
import { IdOut, NotFound, Unavailable } from "@/lib/shapes";
import { bindCrud } from "@/lib/resource";
import { create as createTask } from "@/flows/tasks/index";
import { formChanged, formIntake, formSubmitted } from "./signals";

import "./signals";

const createIn = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  schemaJson: z.string().optional(),
});

export const { list, get, update, remove } = bindCrud({
  unit: "forms",
  path: "/forms",
  table: forms,
  read: member,
  write: projectAdminWrite,
  createIn,
  out: formsZod.select,
  search: ["name"],
  skipCreate: true,
});

/** Create a form. */
export const create = on(
  http.post("/forms").gate(projectAdminWrite),
  flow("forms.create", {
    in: z.object({
      projectId: z.string().min(1),
      name: z.string().min(1),
      schemaJson: z.string().optional(),
    }),
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const project = await fx.store(db).findById(projects, input.projectId);
      if (!project) return fail("NotFound", { id: input.projectId });
      const id = fx.id();
      await fx
        .store(db)
        .insert(forms)
        .values({
          id,
          projectId: input.projectId,
          name: input.name,
          schemaJson: input.schemaJson ?? "{}",
        });
      return { id };
    },
  }),
);

/** Submit a form — durable intake → task. */
export const submit = on(
  http.post("/forms/:id/submit").gate(member),
  flow("forms.submit", {
    plane: "user",
    durable: true,
    in: z.object({
      id: z.string().min(1),
      title: z.string().min(1).optional(),
      body: z.string().optional(),
      customerName: z.string().min(1),
    }),
    out: z.object({ id: z.string(), taskId: z.string(), identifier: z.string() }),
    errors: { NotFound, Unavailable },
    do: async (input, fx) => {
      const form = await fx.store(db).findById(forms, input.id);
      if (!form) return fail("NotFound", { id: input.id });
      const project = await fx.store(db).findById(projects, String(form.projectId));
      const spaceRows = await fx.store(db).select().from(spaces);
      const space = project
        ? spaceRows.find((s) => String(s.id) === String(project.spaceId))
        : spaceRows[0];
      await fx.vault.get(openaiKey);
      let title = input.title ?? input.body?.slice(0, 80) ?? "Form request";
      let roleNeeded = "developer";
      let priority = 2;
      try {
        const out = await fx.ask(formClassifyPrompt, {
          title: input.title ?? "",
          body: input.body ?? "",
        });
        if (out && typeof out === "object") {
          const rec = out as Record<string, unknown>;
          if (typeof rec.title === "string" && rec.title.length > 0) title = rec.title;
          if (typeof rec.roleNeeded === "string") roleNeeded = rec.roleNeeded;
          if (typeof rec.priority === "number") priority = rec.priority;
        }
      } catch {
        // keep defaults
      }
      const created = (await fx.call(createTask, {
        title,
        spaceKey: space ? String(space.key) : "ENG",
        description: input.body,
        projectId: project ? String(project.id) : undefined,
        roleNeeded,
        priority,
      })) as { id: string; identifier: string };
      const submissionId = fx.id();
      await fx
        .store(db)
        .insert(formSubmissions)
        .values({
          id: submissionId,
          formId: input.id,
          taskId: created.id,
          payloadJson: JSON.stringify({ title, body: input.body ?? "" }),
          customerName: input.customerName,
        });
      const payload = {
        formId: input.id,
        taskId: created.id,
        customerName: input.customerName,
      };
      await fx.emit(formSubmitted, payload, { key: submissionId });
      await fx.emit(formChanged, payload);
      await fx.emit(formIntake, payload);
      return { id: submissionId, taskId: created.id, identifier: created.identifier };
    },
  }),
);
