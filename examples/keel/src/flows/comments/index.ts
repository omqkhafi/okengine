import { on, flow, http, fail } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { commentWrite, commentsWriteRate, db, issueWrite, member } from "@/core";
import { comments, issues } from "@/db/schema.decl";
import { IdIn, NotFound, Ok } from "@/lib/shapes";
import { commentAdded, commentResolved } from "./signals";

import "./signals";

const CommentIn = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(20_000),
});

const CommentOut = z.object({
  id: z.string(),
  issueId: z.string(),
  authorEmail: z.string().nullable(),
  body: z.string(),
});

const CommentListOut = z.object({
  items: z.array(CommentOut),
  count: z.number(),
});

const WRITE = [member, commentWrite, commentsWriteRate] as const;

/** List comments on an issue. */
export const list = on(
  http.get("/issues/:id/comments").gate(member).live(),
  flow("comments.list", {
    in: IdIn,
    out: CommentListOut,
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(comments);
      const items = rows
        .filter((r) => String(r.issueId) === input.id)
        .map((r) => ({
          id: String(r.id),
          issueId: String(r.issueId),
          authorEmail: r.authorEmail == null ? null : String(r.authorEmail),
          body: String(r.body),
        }));
      return { items, count: items.length };
    },
  }),
);

/** Create a comment. */
export const create = on(
  http.post("/issues/:id/comments").gate(member, issueWrite, commentsWriteRate),
  flow("comments.create", {
    in: CommentIn,
    out: CommentOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const issue = await fx.store(db).findById(issues, input.id);
      if (!issue) return fail("NotFound", { id: input.id });
      const id = fx.id();
      const authorEmail = fx.auth.userId ?? "member@keel.dev";
      await fx.store(db).insert(comments).values({
        id,
        issueId: input.id,
        authorEmail,
        body: input.body,
        resolvedAt: null,
      });
      await fx.emit(commentAdded, { id, issueId: input.id, body: input.body }, { key: id });
      return { id, issueId: input.id, authorEmail, body: input.body };
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
        issueId: String(row.issueId),
        authorEmail: row.authorEmail == null ? null : String(row.authorEmail),
        body: String(row.body),
      };
    },
  }),
);

/** Edit a comment. */
export const update = on(
  http.patch("/comments/:id").gate(...WRITE),
  flow("comments.update", {
    in: z.object({ id: z.string(), body: z.string().min(1) }),
    out: CommentOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(comments, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).update(comments).set({ body: input.body }).where(eq(comments.id, input.id));
      return {
        id: input.id,
        issueId: String(row.issueId),
        authorEmail: row.authorEmail == null ? null : String(row.authorEmail),
        body: input.body,
      };
    },
  }),
);

/** Delete a comment. */
export const remove = on(
  http.delete("/comments/:id").gate(...WRITE),
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
  http.post("/comments/:id/resolve").gate(...WRITE),
  flow("comments.resolve", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(comments, input.id);
      if (!row) return { ok: true as const };
      const resolvedAt = new Date(fx.clock.now()).toISOString();
      await fx.store(db).update(comments).set({ resolvedAt }).where(eq(comments.id, input.id));
      await fx.emit(commentResolved, {
        id: input.id,
        issueId: String(row.issueId),
        body: String(row.body),
      });
      return { ok: true as const };
    },
  }),
);

/** Clear resolved. */
export const unresolve = on(
  http.post("/comments/:id/unresolve").gate(...WRITE),
  flow("comments.unresolve", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      await fx.store(db).update(comments).set({ resolvedAt: null }).where(eq(comments.id, input.id));
      return { ok: true as const };
    },
  }),
);
