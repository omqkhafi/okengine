import { signal } from "okengine";
import { z } from "zod";
import { tasksZod } from "@/db/zod";

const TaskRef = tasksZod.select.pick({
  id: true,
  identifier: true,
  title: true,
});

/** Task created — index job (exactly one worker). */
export const taskCreated = signal.once("task-created", {
  retries: 5,
  deadLetter: true,
  schema: TaskRef.extend({ assigneeEmail: z.string().nullable() }),
});

/** Task changed — fan-out (notify). */
export const taskChanged = signal.broadcast("task-changed", {
  retries: 3,
  deadLetter: true,
  schema: TaskRef.extend({ assigneeEmail: z.string().nullable().optional() }),
});

/** Task completed — fan-out. */
export const taskCompleted = signal.broadcast("task-completed", {
  retries: 3,
  deadLetter: true,
  schema: TaskRef,
});

/** Assignee changed — realtime inbox. */
export const taskAssigned = signal.live("task-assigned", {
  optional: true,
  retries: 3,
  deadLetter: true,
  schema: TaskRef.extend({ email: z.string() }),
});
