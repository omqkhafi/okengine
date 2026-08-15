import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, member, projectAdminWrite, viewPrefsKv } from "@/core";
import { sections, tasks, views } from "@/db/schema.decl";
import { viewsZod } from "@/db/zod";
import { listIn, pageOut, queryPage } from "@/lib/http";
import { IdOut, NotFound } from "@/lib/shapes";
import { bindCrud } from "@/lib/resource";

const createIn = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["list", "board", "timeline", "calendar"]),
  filtersJson: z.string().optional(),
  ownerEmail: z.string().optional(),
});

export const { list, get, update, remove } = bindCrud({
  unit: "views",
  path: "/views",
  table: views,
  read: member,
  write: projectAdminWrite,
  createIn,
  out: viewsZod.select,
  search: ["name", "kind"],
  skipCreate: true,
});

/** Create a saved view. */
export const create = on(
  http.post("/views").gate(projectAdminWrite),
  flow("views.create", {
    in: createIn.extend({
      projectId: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum(["list", "board", "timeline", "calendar"]),
    }),
    out: IdOut,
    do: async (input, fx) => {
      const id = fx.id();
      await fx.store(db).insert(views).values({
        id,
        projectId: input.projectId,
        name: input.name,
        kind: input.kind,
        filtersJson: input.filtersJson ?? "{}",
        ownerEmail: fx.auth.userId ?? input.ownerEmail ?? null,
      });
      await fx.store(viewPrefsKv).set(id, { kind: input.kind, projectId: input.projectId });
      return { id };
    },
  }),
);

/** Board = tasks grouped by section. */
export const board = on(
  http.get("/views/:id/board").gate(member),
  flow("views.board", {
    in: listIn({ mode: "offset" }, { id: z.string().min(1) }),
    out: pageOut(
      z.object({
        sectionId: z.string(),
        name: z.string(),
        tasks: z.array(z.object({ id: z.string(), title: z.string(), identifier: z.string() })),
      }),
    ),
    errors: { NotFound },
    do: async (input, fx) => {
      const view = await fx.store(db).findById(views, input.id);
      if (!view) return fail("NotFound", { id: input.id });
      const projectId = String(view.projectId);
      const sectionRows = await fx.store(db).select().from(sections);
      const taskRows = await fx.store(db).select().from(tasks);
      const cols = sectionRows
        .filter((s) => String(s.projectId) === projectId)
        .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
        .map((s) => ({
          sectionId: String(s.id),
          name: String(s.name),
          tasks: taskRows
            .filter((t) => String(t.sectionId) === String(s.id) && t.archivedAt == null)
            .map((t) => ({
              id: String(t.id),
              title: String(t.title),
              identifier: String(t.identifier),
            })),
        }));
      return fx.json.with(queryPage(cols, input, { mode: "offset", search: ["name"] }));
    },
  }),
);
