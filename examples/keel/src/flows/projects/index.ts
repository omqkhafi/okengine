import { on, flow, http, fail, table } from "okengine";
import { z } from "zod";

import { db, member, projectAdmin, projectUpdateMail } from "@/core";
import { initiatives, projectMilestones, projects, projectUpdates } from "@/db/schema.decl";
import { IdIn, IdOut, NotFound, Ok } from "@/lib/shapes";
import { bindNamedTableCrud } from "@/lib/resource";
import { projectUpdated } from "./signals";

import "./signals";

const ProjectIn = z.object({
  initiativeId: z.string().min(1),
  name: z.string().min(1).max(200),
  status: z.string().optional(),
  leadEmail: z.string().optional(),
  targetDate: z.string().optional(),
  progress: z.number().int().optional(),
});

const bound = bindNamedTableCrud({
  unit: "projects",
  path: "/projects",
  table: projects,
  read: [member],
  write: [member, projectAdmin],
  liveList: true,
  defaults: { status: "planned", progress: 0 },
});

export const list = bound.list;
export const get = bound.get;
export const update = bound.update;
export const remove = bound.remove;

/** Create a project under an initiative. */
export const create = on(
  http.post("/projects").gate(member, projectAdmin),
  flow("projects.create", {
    in: ProjectIn,
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const initiative = await fx.store(db).findById(initiatives, input.initiativeId);
      if (!initiative) return fail("NotFound", { id: input.initiativeId });
      const id = fx.id();
      await fx.store(db).insert(projects).values({
        id,
        initiativeId: input.initiativeId,
        name: input.name,
        status: input.status ?? "planned",
        leadEmail: input.leadEmail ?? null,
        targetDate: input.targetDate ?? null,
        progress: input.progress ?? 0,
      });
      return { id };
    },
  }),
);

/** Archive a project. */
export const archive = on(
  http.post("/projects/:id/archive").gate(member, projectAdmin),
  flow("projects.archive", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(projects, input.id);
      if (!row) return { ok: true as const };
      await fx.store(db).update(projects).set({ status: "archived" }).where({ id: input.id } as never);
      await fx.emit(projectUpdated, {
        projectId: input.id,
        name: String(row.name),
        health: "archived",
      });
      return { ok: true as const };
    },
  }),
);

/** Post a health update. */
export const postUpdate = on(
  http.post("/projects/:id/updates").gate(member, projectAdmin),
  flow("projects.postUpdate", {
    in: z.object({ id: z.string(), body: z.string().min(1), health: z.string().optional() }),
    out: IdOut,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(projects, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const id = fx.id();
      const health = input.health ?? "on_track";
      await fx.store(db).insert(projectUpdates).values({
        id,
        projectId: input.id,
        health,
        body: input.body,
        authorEmail: fx.auth.userId ?? "ops@keel.dev",
      });
      await fx.emit(projectUpdated, { projectId: input.id, name: String(row.name), health });
      await fx.send(projectUpdateMail, {
        to: String(row.leadEmail ?? "ops@keel.dev"),
        data: { projectId: input.id, name: String(row.name), health },
      });
      return { id };
    },
  }),
);

/** List project updates. */
export const listUpdates = on(
  http.get("/projects/:id/updates").gate(member),
  flow("projects.listUpdates", {
    in: IdIn,
    out: z.object({ items: z.array(z.object({ id: z.string(), body: z.string() })) }),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(projectUpdates);
      const items = rows
        .filter((r) => String(r.projectId) === input.id)
        .map((r) => ({ id: String(r.id), body: String(r.body) }));
      return { items };
    },
  }),
);

/** List milestones. */
export const listMilestones = on(
  http.get("/projects/:id/milestones").gate(member),
  flow("projects.listMilestones", {
    in: IdIn,
    out: z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) }),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(projectMilestones);
      const items = rows
        .filter((r) => String(r.projectId) === input.id)
        .map((r) => ({ id: String(r.id), name: String(r.name) }));
      return { items };
    },
  }),
);

/** Add a milestone. */
export const addMilestone = on(
  http.post("/projects/:id/milestones").gate(member, projectAdmin),
  flow("projects.addMilestone", {
    in: z.object({ id: z.string(), title: z.string().min(1) }),
    out: IdOut,
    do: async (input, fx) => {
      const project = await fx.store(db).findById(projects, input.id);
      if (!project) return fail("NotFound", { id: input.id });
      const id = fx.id();
      await fx.store(db).insert(projectMilestones).values({
        id,
        projectId: input.id,
        name: input.title,
        targetDate: null,
        sortOrder: 0,
      });
      return { id };
    },
  }),
);

/** Patch a milestone. */
export const updateMilestone = on(
  http.patch("/projects/:id/milestones/:mid").gate(member, projectAdmin),
  flow("projects.updateMilestone", {
    in: z.object({ id: z.string(), mid: z.string(), title: z.string().min(1) }),
    out: IdOut,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(projectMilestones, input.mid);
      if (!row) return fail("NotFound", { id: input.mid });
      await fx
        .store(db)
        .update(projectMilestones)
        .set({ name: input.title })
        .where({ id: input.mid } as never);
      return { id: input.mid };
    },
  }),
);

/** CDC — project update health. */
export const onHealth = on(
  table("project_updates").changed("health"),
  flow("projects.onHealth", {
    plane: "operator",
    do: async (input, fx) => {
      const id = String((input as { id?: string }).id ?? "");
      if (!id) return;
      const row = await fx.store(db).findById(projectUpdates, id);
      if (!row) return;
      await fx.emit(projectUpdated, {
        projectId: String(row.projectId),
        name: String(row.projectId),
        health: String(row.health),
      });
    },
  }),
);
