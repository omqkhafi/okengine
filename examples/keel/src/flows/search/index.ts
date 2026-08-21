import { on, flow, http, fail, type Fx } from "okengine";

import { db, member, openaiKey, publicDocsUrl, taskIndex } from "@/core";
import { comments, tasks } from "@/db/schema.decl";
import { tasksZod } from "@/db/zod";
import { listIn, pageOut, queryPage } from "@/lib/http";
import { Ok } from "@/lib/shapes";
import { commentChanged } from "@/flows/comments/signals";
import { formChanged } from "@/flows/forms/signals";
import { projectChanged } from "@/flows/projects/signals";
import { taskCompleted, taskCreated } from "@/flows/tasks/signals";

const SearchHit = tasksZod.select.pick({
  id: true,
  title: true,
  identifier: true,
});

const SearchIn = listIn({ mode: "offset", maxLimit: 50 });
const SearchOut = pageOut(SearchHit);

async function upsertTask(fx: Fx, row: Record<string, unknown>): Promise<void> {
  const idx = fx.store(taskIndex) as {
    driverId: string;
    upsert: (id: string, doc: unknown, meta?: Record<string, unknown>) => Promise<void>;
  };
  const id = String(row.id);
  const meta = {
    title: String(row.title),
    identifier: String(row.identifier),
  };
  if (idx.driverId === "meilisearch") {
    await idx.upsert(id, { id, ...meta, description: String(row.description ?? "") });
  } else {
    await idx.upsert(id, [0, 0, 0], meta);
  }
}

/** QUERY search — index first, SQL fallback. */
export const query = on(
  http.query("/search").gate(member),
  flow("search.query", {
    in: SearchIn,
    out: SearchOut,
    do: async (input, fx) => {
      if (!input.q?.trim()) {
        return fx.json.with(queryPage([], input, { mode: "offset", maxLimit: 50 }));
      }
      await fx.vault.get(publicDocsUrl);
      const idx = fx.store(taskIndex) as {
        driverId: string;
        search: (q: unknown, opts?: { limit?: number }) => Promise<unknown>;
      };
      const limit = input.limit ?? 25;
      if (idx.driverId === "meilisearch") {
        const result = (await idx.search(input.q, { limit })) as {
          hits?: ReadonlyArray<{ id: string; title?: string; identifier?: string }>;
        };
        const items = (result.hits ?? []).map((h) => ({
          id: String(h.id),
          title: String(h.title ?? ""),
          identifier: String(h.identifier ?? ""),
        }));
        return fx.json.with(
          queryPage(items, { ...input, q: undefined }, { mode: "offset", maxLimit: 50 }),
        );
      }
      const rows = await fx.store(db).select().from(tasks);
      const items = rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        identifier: String(r.identifier),
      }));
      return fx.json.with(
        queryPage(items, input, {
          mode: "offset",
          search: ["title", "identifier"],
          maxLimit: 50,
        }),
      );
    },
  }),
);

/** Suggest from the index. */
export const suggest = on(
  http.get("/search/suggest").gate(member),
  flow("search.suggest", {
    in: SearchIn,
    out: SearchOut,
    do: async (input, fx) => {
      if (!input.q) {
        return fx.json.with(
          queryPage([], { ...input, limit: input.limit ?? 8 }, { mode: "offset", maxLimit: 50 }),
        );
      }
      return await fx.call(query, { q: input.q, limit: input.limit ?? 8 });
    },
  }),
);

/** Reindex every task. */
export const reindex = on(
  http.post("/search/reindex").gate(member),
  flow("search.reindex", {
    plane: "operator",
    durable: true,
    out: Ok,
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(tasks);
      for (const row of rows) {
        await fx.call(embedTask, { id: String(row.id) });
      }
      return { ok: true as const };
    },
  }),
);

/** Index one task (call-only). */
export const embedTask = flow("search.embedTask", {
  plane: "operator",
  in: tasksZod.select.pick({ id: true }),
  out: Ok,
  do: async (input, fx) => {
    await fx.vault.get(openaiKey);
    const row = await fx.store(db).findById(tasks, input.id);
    if (!row) return fail("NotFound", { id: input.id });
    await upsertTask(fx, row as Record<string, unknown>);
    return { ok: true as const };
  },
});

/** On create → index. */
export const indexOnCreate = on(
  taskCreated,
  flow("search.index", {
    plane: "operator",
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(tasks, payload.id);
      if (row) await upsertTask(fx, row as Record<string, unknown>);
    },
  }),
);

/** On comment change → touch the task index. */
export const onComment = on(
  commentChanged,
  flow("search.onComment", {
    plane: "operator",
    do: async (payload, fx) => {
      await fx.store(db).findById(comments, payload.id);
      const row = await fx.store(db).findById(tasks, payload.taskId);
      if (row) await upsertTask(fx, row as Record<string, unknown>);
    },
  }),
);

/** On complete → refresh the task index. */
export const onComplete = on(
  taskCompleted,
  flow("search.onComplete", {
    plane: "operator",
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(tasks, payload.id);
      if (row) await upsertTask(fx, row as Record<string, unknown>);
    },
  }),
);

/** On form change → index the created task. */
export const onForm = on(
  formChanged,
  flow("search.onForm", {
    plane: "operator",
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(tasks, payload.taskId);
      if (row) await upsertTask(fx, row as Record<string, unknown>);
    },
  }),
);

/** On project change → reindex tasks in the project. */
export const onProject = on(
  projectChanged,
  flow("search.onProject", {
    plane: "operator",
    do: async (payload, fx) => {
      const rows = await fx.store(db).select().from(tasks);
      for (const row of rows) {
        if (String(row.projectId) !== payload.projectId) continue;
        await upsertTask(fx, row as Record<string, unknown>);
      }
    },
  }),
);
