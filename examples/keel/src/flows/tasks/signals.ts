import { signal } from "okengine";
import { z } from "zod";
import { tasksZod } from "@/db/zod";

const TaskRef = tasksZod.select.pick({
  id: true,
  identifier: true,
  title: true,
});

/** Task created — index job (exactly one worker). */
export const taskCreated = signal("task-created", {
  delivery: "once",
  retries: 5,
  deadLetter: true,
  schema: TaskRef.extend({ assigneeEmail: z.string().nullable() }),
});

/** Task changed — fan-out (notify). */
export const taskChanged = signal("task-changed", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: TaskRef.extend({ assigneeEmail: z.string().nullable().optional() }),
});

/** Task completed — fan-out. */
export const taskCompleted = signal("task-completed", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: TaskRef,
});

/** Assignee changed — realtime inbox. */
export const taskAssigned = signal("task-assigned", {
  delivery: "live",
  optional: true,
  retries: 3,
  deadLetter: true,
  schema: TaskRef.extend({ email: z.string() }),
});
