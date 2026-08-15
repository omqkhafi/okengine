import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, member, projectAdminWrite } from "@/core";
import { projectUpdates, projects, sections } from "@/db/schema.decl";
import { projectUpdatesZod, projectsZod, sectionsZod } from "@/db/zod";
import { listIn, pageOut, queryPage } from "@/lib/http";
import { IdIn, IdOut, NotFound, Ok } from "@/lib/shapes";
import { bindCrud } from "@/lib/resource";
import { projectChanged, projectHealth, projectUpdated } from "./signals";

import "./signals";

const createIn = z.object({
  spaceId: z.string().min(1),
  goalId: z.string().optional(),
  name: z.string().min(1).max(200),
  status: z.string().optional(),
  leadEmail: z.string().optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  color: z.string().optional(),
});

export const { list, get, update, remove } = bindCrud({
  unit: "projects",
  path: "/projects",
  table: projects,
  read: member,
  write: projectAdminWrite,
  liveList: true,
  createIn,
  out: projectsZod.select,
  defaults: { status: "planned" },
  search: ["name", "status"],
  skipCreate: true,
});

/** Create a project. */
export const create = on(
  http.post("/projects").gate(projectAdminWrite),
  flow("projects.create", {
    in: createIn.extend({ spaceId: z.string().min(1), name: z.string().min(1).max(200) }),
    out: IdOut,
    do: async (input, fx) => {
      const id = fx.id();
      await fx.store(db).insert(projects).values({
        id,
        spaceId: input.spaceId,
        goalId: input.goalId ?? null,
        name: input.name,
        status: input.status ?? "planned",
        leadEmail: input.leadEmail ?? null,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        color: input.color ?? null,
      });
      return { id };
    },
  }),
);

/** Archive a project. */
export const archive = on(
  http.post("/projects/:id/archive").gate(projectAdminWrite),
  flow("projects.archive", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(projects, input.id);
      if (!row) return { ok: true as const };
      await fx
        .store(db)
        .update(projects)
        .set({ status: "archived" })
        .where({ id: input.id } as never);
      const payload = {
        projectId: input.id,
        name: String(row.name),
        health: "archived",
        actorEmail: fx.auth.userId,
      };
      await fx.emit(projectUpdated, payload, { key: input.id });
      await fx.emit(projectChanged, payload);
      await fx.emit(projectHealth, payload);
      return { ok: true as const };
    },
  }),
);

/** Post a health update. */
export const postUpdate = on(
  http.post("/projects/:id/updates").gate(projectAdminWrite),
  flow("projects.postUpdate", {
    in: projectUpdatesZod.insert.pick({ body: true, health: true }).extend({
      id: z.string(),
      body: z.string().min(1),
      health: z.string().optional(),
    }),
    out: IdOut,
    errors: { NotFound },
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
      const payload = {
        projectId: input.id,
        name: String(row.name),
        health,
        actorEmail: fx.auth.userId,
      };
      await fx.emit(projectUpdated, payload, { key: input.id });
      await fx.emit(projectChanged, payload);
      await fx.emit(projectHealth, payload);
      return { id };
    },
  }),
);

/** List project updates. */
export const listUpdates = on(
  http.get("/projects/:id/updates").gate(member),
  flow("projects.listUpdates", {
    in: listIn({ mode: "offset" }, { id: z.string().min(1) }),
    out: pageOut(projectUpdatesZod.select.pick({ id: true, body: true, health: true })),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(projectUpdates);
      const items = rows
        .filter((r) => String(r.projectId) === input.id)
        .map((r) => ({
          id: String(r.id),
          body: String(r.body),
          health: String(r.health),
        }));
      return fx.json.with(queryPage(items, input, { mode: "offset", search: ["body"] }));
    },
  }),
);

/** List sections (board columns). */
export const listSections = on(
  http.get("/projects/:id/sections").gate(member),
  flow("projects.listSections", {
    in: listIn({ mode: "offset" }, { id: z.string().min(1) }),
    out: pageOut(sectionsZod.select.pick({ id: true, name: true, sortOrder: true })),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(sections);
      const items = rows
        .filter((r) => String(r.projectId) === input.id)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          sortOrder: Number(r.sortOrder),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return fx.json.with(queryPage(items, input, { mode: "offset", search: ["name"] }));
    },
  }),
);

/** Add a section. */
export const addSection = on(
  http.post("/projects/:id/sections").gate(projectAdminWrite),
  flow("projects.addSection", {
    in: z.object({ id: z.string(), name: z.string().min(1) }),
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const project = await fx.store(db).findById(projects, input.id);
      if (!project) return fail("NotFound", { id: input.id });
      const existing = await fx.store(db).select().from(sections);
      const sortOrder = existing.filter((r) => String(r.projectId) === input.id).length;
      const id = fx.id();
      await fx.store(db).insert(sections).values({
        id,
        projectId: input.id,
        name: input.name,
        sortOrder,
      });
      return { id };
    },
  }),
);
