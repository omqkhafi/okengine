import { on, flow, http, fail } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, filesWrite, keelFiles, member, taskWrite } from "@/core";
import { fileObjects, tasks } from "@/db/schema.decl";
import { fileObjectsZod } from "@/db/zod";
import { listIn, pageOut } from "@/lib/http";
import { IdIn, IdOut, NotFound, Ok } from "@/lib/shapes";

const FileRef = fileObjectsZod.select.pick({ id: true, objectKey: true });

const UploadIn = z.object({
  taskId: z.string().min(1).optional(),
  id: z.string().optional(),
  name: z.string().min(1),
  text: z.string().min(1),
  contentType: z.string().optional(),
});

/** Upload an attachment. */
export const upload = on(
  http.post("/attachments").gate(member, taskWrite),
  flow("attachments.upload", {
    in: UploadIn,
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const taskId = input.taskId ?? input.id;
      if (!taskId) return fail("NotFound", { id: "task" });
      const task = await fx.store(db).findById(tasks, taskId);
      if (!task) return fail("NotFound", { id: taskId });
      const id = fx.id();
      const key = `attachments/${taskId}/${input.name}`;
      await fx.store(keelFiles).put(key, input.text);
      await fx
        .store(db)
        .insert(fileObjects)
        .values({
          id,
          objectKey: key,
          originalName: input.name,
          contentType: input.contentType ?? "text/plain",
          sizeBytes: new TextEncoder().encode(input.text).byteLength,
          storeRef: keelFiles.ref,
        });
      return { id };
    },
  }),
);

/** List attachments for a task. */
export const list = on(
  http.get("/tasks/:id/attachments").gate(member),
  flow("attachments.list", {
    in: listIn({ mode: "offset" }, { id: z.string().min(1) }),
    out: pageOut(FileRef),
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(fileObjects);
      const prefix = `attachments/${input.id}/`;
      const items = rows
        .filter((r) => String(r.objectKey).startsWith(prefix))
        .map((r) => ({ id: String(r.id), objectKey: String(r.objectKey) }));
      return fx.json.withQuery(items, input);
    },
  }),
);

/** Get one attachment row. */
export const get = on(
  http.get("/attachments/:id").gate(member),
  flow("attachments.get", {
    in: IdIn,
    out: FileRef,
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
      await fx.store(keelFiles).delete(String(row.objectKey));
      await fx.store(db).delete(fileObjects).where(eq(fileObjects.id, input.id));
      return { ok: true as const };
    },
  }),
);
