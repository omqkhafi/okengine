import { on, flow, http, fail, table } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, keelWorkspace, publicAppUrl, taskAssignedMail, tasksWrite, member } from "@/core";
import {
  activity,
  inbox,
  spaces,
  taskAssignees,
  taskDependencies,
  taskFollowers,
  taskTags,
  tasks,
} from "@/db/schema.decl";
import { queryPage } from "@/lib/http";
import { IdIn, Ok, NotFound, Duplicate } from "@/lib/shapes";
import {
  AssignIn,
  DependIn,
  MoveIn,
  TagIn,
  TaskCreateIn,
  TaskCreateOut,
  TaskListIn,
  TaskListOut,
  TaskOut,
  TaskUpdateIn,
} from "./shapes";
import { taskAssigned, taskChanged, taskCompleted, taskCreated } from "./signals";

import "./signals";

type TaskRow = z.infer<typeof TaskOut>;

function asTask(row: Record<string, unknown>): TaskRow {
  return TaskOut.parse({
    id: String(row.id),
    identifier: String(row.identifier),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    kind: String(row.kind ?? "task"),
    priority: Number(row.priority),
    estimate: row.estimate == null ? null : Number(row.estimate),
    status: String(row.status),
    spaceId: String(row.spaceId),
    projectId: row.projectId == null ? null : String(row.projectId),
    sectionId: row.sectionId == null ? null : String(row.sectionId),
    parentId: row.parentId == null ? null : String(row.parentId),
    dueDate: row.dueDate == null ? null : String(row.dueDate),
    completedAt: row.completedAt == null ? null : String(row.completedAt),
    archivedAt: row.archivedAt == null ? null : String(row.archivedAt),
    roleNeeded: row.roleNeeded == null ? null : String(row.roleNeeded),
  });
}

async function nextIdentifier(
  fx: { store: typeof db extends infer _D ? (ref: unknown) => { select: () => { from: (t: unknown) => Promise<Record<string, unknown>[]> } } : never },
  spaceKey: string,
): Promise<string> {
  const existing = await fx.store(db).select().from(tasks);
  const prefix = `${spaceKey}-`;
  const next =
    existing
      .map((r) => String(r.identifier))
      .filter((id) => id.startsWith(prefix))
      .map((id) => Number(id.slice(prefix.length)))
      .filter((n) => Number.isFinite(n))
      .reduce((max, n) => Math.max(max, n), 0) + 1;
  return `${spaceKey}-${next}`;
}

async function writeActivity(
  fx: { id: () => string; auth: { userId: string | null }; store: (ref: unknown) => { insert: (t: unknown) => { values: (row: Record<string, unknown>) => Promise<unknown> } } },
  parentId: string,
  kind: string,
  body: string,
): Promise<void> {
  await fx.store(db).insert(activity).values({
    id: fx.id(),
    parentKind: "task",
    parentId,
    actorEmail: fx.auth.userId,
    kind,
    body,
  });
}

/** Create a task, emit `task-created`. */
export const create = on(
  http.post("/tasks").gate(tasksWrite),
  flow("tasks.create", {
    in: TaskCreateIn,
    out: TaskCreateOut,
    errors: { NotFound, Duplicate },
    do: async (input, fx) => {
      await fx.vault.get(keelWorkspace);
      const spaceRows = await fx.store(db).select().from(spaces);
      const space = spaceRows.find((r) => String(r.key) === input.spaceKey);
      if (!space) return fail("NotFound", { id: input.spaceKey });
      const identifier = await nextIdentifier(fx as never, input.spaceKey);
      const id = fx.id();
      await fx.store(db).insert(tasks).values({
        id,
        identifier,
        title: input.title,
        description: input.description ?? "",
        kind: input.kind ?? "task",
        priority: input.priority ?? 3,
        estimate: null,
        status: "todo",
        spaceId: String(space.id),
        projectId: input.projectId ?? null,
        sectionId: input.sectionId ?? null,
        parentId: input.parentId ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        completedAt: null,
        archivedAt: null,
        creatorEmail: fx.auth.userId ?? null,
        roleNeeded: input.roleNeeded ?? null,
      });
      if (input.assigneeEmail) {
        await fx.store(db).insert(taskAssignees).values({
          id: fx.id(),
          taskId: id,
          assigneeEmail: input.assigneeEmail,
        });
      }
      await writeActivity(fx as never, id, "created", input.title);
      const created = {
        id,
        identifier,
        title: input.title,
        assigneeEmail: input.assigneeEmail ?? null,
      };
      await fx.emit(taskCreated, created, { key: id });
      await fx.emit(taskChanged, created);
      if (input.assigneeEmail) {
        await fx.emit(taskAssigned, {
          id,
          identifier,
          title: input.title,
          email: input.assigneeEmail,
        });
      }
      return { id, identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Patch task fields. */
export const update = on(
  http.patch("/tasks/:id").gate(tasksWrite),
  flow("tasks.update", {
    in: TaskUpdateIn,
    out: TaskOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const patch: Record<string, unknown> = { updatedAt: fx.clock.now() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.estimate !== undefined) patch.estimate = input.estimate;
      if (input.status !== undefined) patch.status = input.status;
      if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
      if (input.roleNeeded !== undefined) patch.roleNeeded = input.roleNeeded;
      await fx.store(db).update(tasks).set(patch).where(eq(tasks.id, input.id));
      const next = await fx.store(db).findById(tasks, input.id);
      const task = asTask(next as Record<string, unknown>);
      await writeActivity(fx as never, task.id, "updated", task.title);
      return task;
    },
  }),
);

/** List tasks (live) — filter in SQL when project/status given. */
export const list = on(
  http.get("/tasks").gate(member).live(),
  flow("tasks.list", {
    in: TaskListIn,
    out: TaskListOut,
    do: async (input, fx) => {
      await fx.vault.get(publicAppUrl);
      let rows = await fx.store(db).select().from(tasks);
      if (input.spaceKey) {
        const spaceRows = await fx.store(db).select().from(spaces);
        const space = spaceRows.find((t) => String(t.key) === input.spaceKey);
        if (space) rows = rows.filter((i) => String(i.spaceId) === String(space.id));
      }
      if (input.projectId) rows = rows.filter((i) => String(i.projectId) === input.projectId);
      if (input.status) rows = rows.filter((i) => String(i.status) === input.status);
      const items = rows
        .filter((r) => r.archivedAt == null)
        .map((r) => asTask(r as Record<string, unknown>));
      return fx.json.with(
        queryPage(items, input, {
          mode: "offset",
          search: ["title", "identifier"],
          filter: "all",
          order: "all",
          select: "all",
        }),
      );
    },
  }),
);

/** Fetch one task. */
export const get = on(
  http.get("/tasks/:id").gate(member),
  flow("tasks.get", {
    in: IdIn,
    out: TaskOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      return asTask(row as Record<string, unknown>);
    },
  }),
);

/** Assign a task and notify. */
export const assign = on(
  http.post("/tasks/:id/assign").gate(tasksWrite),
  flow("tasks.assign", {
    in: AssignIn,
    out: TaskCreateOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).insert(taskAssignees).values({
        id: fx.id(),
        taskId: input.id,
        assigneeEmail: input.assigneeEmail,
      });
      const task = asTask(row as Record<string, unknown>);
      await writeActivity(fx as never, task.id, "assigned", input.assigneeEmail);
      await fx.send(taskAssignedMail, {
        to: input.assigneeEmail,
        data: {
          id: task.id,
          identifier: task.identifier,
          title: task.title,
          email: input.assigneeEmail,
        },
      });
      await fx.store(db).insert(inbox).values({
        id: fx.id(),
        memberEmail: input.assigneeEmail,
        kind: "task-assigned",
        title: task.title,
        refId: task.id,
        readAt: null,
        createdAt: fx.clock.now(),
      });
      await fx.emit(taskAssigned, {
        id: task.id,
        identifier: task.identifier,
        title: task.title,
        email: input.assigneeEmail,
      });
      return { id: task.id, identifier: task.identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Mark complete. */
export const complete = on(
  http.post("/tasks/:id/complete").gate(tasksWrite),
  flow("tasks.complete", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const completedAt = new Date(fx.clock.now()).toISOString();
      await fx
        .store(db)
        .update(tasks)
        .set({ status: "done", completedAt, updatedAt: fx.clock.now() })
        .where(eq(tasks.id, input.id));
      const task = asTask(row as Record<string, unknown>);
      await writeActivity(fx as never, task.id, "completed", task.title);
      await fx.emit(taskCompleted, {
        id: task.id,
        identifier: task.identifier,
        title: task.title,
      });
      return { ok: true as const };
    },
  }),
);

/** Soft-archive. */
export const archive = on(
  http.post("/tasks/:id/archive").gate(tasksWrite),
  flow("tasks.archive", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const archivedAt = new Date(fx.clock.now()).toISOString();
      await fx.store(db).update(tasks).set({ archivedAt }).where(eq(tasks.id, input.id));
      return { ok: true as const };
    },
  }),
);

/** Follow a task. */
export const follow = on(
  http.post("/tasks/:id/follow").gate(member),
  flow("tasks.follow", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const email = fx.auth.userId ?? "ops@keel.dev";
      await fx.store(db).insert(taskFollowers).values({
        id: fx.id(),
        taskId: input.id,
        followerEmail: email,
      });
      return { ok: true as const };
    },
  }),
);

/** Unfollow a task. */
export const unfollow = on(
  http.post("/tasks/:id/unfollow").gate(member),
  flow("tasks.unfollow", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const email = fx.auth.userId ?? "";
      const rows = await fx.store(db).select().from(taskFollowers);
      const hit = rows.find(
        (r) => String(r.taskId) === input.id && String(r.followerEmail) === email,
      );
      if (hit) {
        await fx.store(db).delete(taskFollowers).where(eq(taskFollowers.id, String(hit.id)));
      }
      return { ok: true as const };
    },
  }),
);

/** Duplicate via `tasks.create`. */
export const duplicate = on(
  http.post("/tasks/:id/duplicate").gate(tasksWrite),
  flow("tasks.duplicate", {
    in: IdIn,
    out: TaskCreateOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const task = asTask(row as Record<string, unknown>);
      const spaceRows = await fx.store(db).select().from(spaces);
      const space = spaceRows.find((t) => String(t.id) === task.spaceId);
      return (await fx.call(create, {
        title: `${task.title} (copy)`,
        spaceKey: space ? String(space.key) : "ENG",
        priority: task.priority,
        description: task.description ?? undefined,
        projectId: task.projectId ?? undefined,
      })) as { id: string; identifier: string; userId: string | null };
    },
  }),
);

/** Move to another project / section / space. */
export const move = on(
  http.post("/tasks/:id/move").gate(tasksWrite),
  flow("tasks.move", {
    in: MoveIn,
    out: TaskCreateOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const patch: Record<string, unknown> = { updatedAt: fx.clock.now() };
      if (input.projectId !== undefined) patch.projectId = input.projectId;
      if (input.sectionId !== undefined) patch.sectionId = input.sectionId;
      if (input.spaceKey) {
        const spaceRows = await fx.store(db).select().from(spaces);
        const space = spaceRows.find((t) => String(t.key) === input.spaceKey);
        if (!space) return fail("NotFound", { id: input.spaceKey });
        patch.spaceId = String(space.id);
      }
      await fx.store(db).update(tasks).set(patch).where(eq(tasks.id, input.id));
      const task = asTask(row as Record<string, unknown>);
      return { id: task.id, identifier: task.identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Record a blocks/blocked-by edge. */
export const depend = on(
  http.post("/tasks/:id/depend").gate(tasksWrite),
  flow("tasks.depend", {
    in: DependIn,
    out: Ok,
    errors: { NotFound, Duplicate },
    do: async (input, fx) => {
      if (input.id === input.blocksTaskId) return fail("Duplicate", { id: input.id });
      const row = await fx.store(db).findById(tasks, input.id);
      const other = await fx.store(db).findById(tasks, input.blocksTaskId);
      if (!row || !other) return fail("NotFound", { id: input.id });
      await fx.store(db).insert(taskDependencies).values({
        id: fx.id(),
        taskId: input.id,
        blocksTaskId: input.blocksTaskId,
      });
      return { ok: true as const };
    },
  }),
);

/** Attach a tag. */
export const addTag = on(
  http.post("/tasks/:id/tags").gate(tasksWrite),
  flow("tasks.addTag", {
    in: TagIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).insert(taskTags).values({
        id: fx.id(),
        taskId: input.id,
        tagId: input.tagId,
      });
      return { ok: true as const };
    },
  }),
);

/** Delete a task. */
export const remove = on(
  http.delete("/tasks/:id").gate(tasksWrite),
  flow("tasks.delete", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(tasks, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).delete(tasks).where(eq(tasks.id, input.id));
      return { ok: true as const };
    },
  }),
);

/** CDC — status changed → activity. */
export const onStatus = on(
  table("tasks").changed("status"),
  flow("tasks.onStatus", {
    plane: "operator",
    do: async (input, fx) => {
      const id = String((input as { id?: string }).id ?? "");
      if (!id) return;
      const row = await fx.store(db).findById(tasks, id);
      if (!row) return;
      await writeActivity(fx as never, id, "status", String(row.status));
    },
  }),
);
