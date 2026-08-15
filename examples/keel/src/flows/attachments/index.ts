import { on, flow, http, fail } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { attachments, db, filesWrite, issueWrite, member } from "@/core";
import { fileObjects, issues } from "@/db/schema.decl";
import { IdIn, IdOut, NotFound, Ok } from "@/lib/shapes";

const UploadIn = z.object({
  issueId: z.string().min(1).optional(),
  id: z.string().optional(),
  name: z.string().min(1),
  text: z.string().min(1),
  contentType: z.string().optional(),
});

/** Upload an attachment (featured). */
export const upload = on(
  http.post("/attachments").gate(member, issueWrite),
  flow("attachments.upload", {
    in: UploadIn,
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const issueId = input.issueId ?? input.id;
      if (!issueId) return fail("NotFound", { id: "issue" });
      const issue = await fx.store(db).findById(issues, issueId);
      if (!issue) return fail("NotFound", { id: issueId });
      const id = fx.id();
      const key = `attachments/${issueId}/${input.name}`;
      await fx.store(attachments).put(key, input.text);
      await fx.store(db).insert(fileObjects).values({
        id,
        objectKey: key,
        originalName: input.name,
        contentType: input.contentType ?? "text/plain",
        sizeBytes: new TextEncoder().encode(input.text).byteLength,
        storeRef: "files:attachments",
      });
      return { id };
    },
  }),
);

/** List attachments for an issue. */
export const list = on(
  http.get("/issues/:id/attachments").gate(member),
  flow("attachments.list", {
    in: IdIn,
    out: z.object({ items: z.array(z.object({ id: z.string(), objectKey: z.string() })) }),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(fileObjects);
      const prefix = `attachments/${input.id}/`;
      const items = rows
        .filter((r) => String(r.objectKey).startsWith(prefix))
        .map((r) => ({ id: String(r.id), objectKey: String(r.objectKey) }));
      return { items };
    },
  }),
);

/** Get one attachment row. */
export const get = on(
  http.get("/attachments/:id").gate(member),
  flow("attachments.get", {
    in: IdIn,
    out: z.object({ id: z.string(), objectKey: z.string() }),
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(fileObjects, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      return { id: String(row.id), objectKey: String(row.objectKey) };
    },
  }),
);

/** Delete attachment + object. */
export const remove = on(
  http.delete("/attachments/:id").gate(member, filesWrite),
  flow("attachments.delete", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(fileObjects, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(attachments).delete(String(row.objectKey));
      await fx.store(db).delete(fileObjects).where(eq(fileObjects.id, input.id));
      return { ok: true as const };
    },
  }),
);
