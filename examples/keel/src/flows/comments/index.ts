import { on, flow, http, fail } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { commentsWrite, db, member, tasksWrite } from "@/core";
import { comments, tasks } from "@/db/schema.decl";
import { commentsZod } from "@/db/zod";
import { listIn, pageOut } from "@/lib/http";
import { IdIn, NotFound, Ok } from "@/lib/shapes";
import { commentAdded, commentChanged, commentThread } from "./signals";

import "./signals";

const CommentOut = commentsZod.select.pick({
  id: true,
  taskId: true,
  authorEmail: true,
  body: true,
});

const CommentIn = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(20_000),
});

/** List comments on a task. */
export const list = on(
  http.get("/tasks/:id/comments").gate(member).live(),
  flow("comments.list", {
    in: listIn({ mode: "offset" }, { id: z.string().min(1) }),
    out: pageOut(CommentOut),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(comments);
      const items = rows
        .filter((r) => String(r.taskId) === input.id)
        .map((r) => ({
          id: String(r.id),
          taskId: String(r.taskId),
          authorEmail: r.authorEmail == null ? null : String(r.authorEmail),
          body: String(r.body),
        }));
      return fx.json.withQuery(items, input);
    },
  }),
);

/** Create a comment. */
export const create = on(
  http.post("/tasks/:id/comments").gate(tasksWrite),
  flow("comments.create", {
    in: CommentIn,
    out: CommentOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const task = await fx.store(db).findById(tasks, input.id);
      if (!task) return fail("NotFound", { id: input.id });
      const id = fx.id();
      const authorEmail = fx.auth.userId ?? "member@keel.dev";
      await fx.store(db).insert(comments).values({
        id,
        taskId: input.id,
        authorEmail,
        body: input.body,
        resolvedAt: null,
      });
      const payload = { id, taskId: input.id, body: input.body };
      await fx.emit(commentAdded, payload, { key: id });
      await fx.emit(commentChanged, payload);
      await fx.emit(commentThread, payload);
      return { id, taskId: input.id, authorEmail, body: input.body };
    },
  }),
);

/** Get one comment. */
export const get = on(
  http.get("/comments/:id").gate(member),
  flow("comments.get", {
    in: IdIn,
    out: CommentOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(comments, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      return {
        id: String(row.id),
        taskId: String(row.taskId),
        authorEmail: row.authorEmail == null ? null : String(row.authorEmail),
        body: String(row.body),
      };
    },
  }),
);

/** Edit a comment. */
export const update = on(
  http.patch("/comments/:id").gate(commentsWrite),
  flow("comments.update", {
    in: CommentIn,
    out: CommentOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(comments, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx
        .store(db)
        .update(comments)
        .set({ body: input.body })
        .where(eq(comments.id, input.id));
      const payload = { id: input.id, taskId: String(row.taskId), body: input.body };
      await fx.emit(commentChanged, payload);
      await fx.emit(commentThread, payload);
      return {
        id: input.id,
        taskId: payload.taskId,
        authorEmail: row.authorEmail == null ? null : String(row.authorEmail),
        body: input.body,
      };
    },
  }),
);

/** Delete a comment. */
export const remove = on(
  http.delete("/comments/:id").gate(commentsWrite),
  flow("comments.delete", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(comments, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).delete(comments).where(eq(comments.id, input.id));
      return { ok: true as const };
    },
  }),
);

/** Mark resolved. */
export const resolve = on(
  http.post("/comments/:id/resolve").gate(commentsWrite),
  flow("comments.resolve", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(comments, input.id);
      if (!row) return { ok: true as const };
      const resolvedAt = new Date(fx.clock.now()).toISOString();
      await fx.store(db).update(comments).set({ resolvedAt }).where(eq(comments.id, input.id));
      const payload = { id: input.id, taskId: String(row.taskId), body: String(row.body) };
      await fx.emit(commentChanged, payload);
      await fx.emit(commentThread, payload);
      return { ok: true as const };
    },
  }),
);
