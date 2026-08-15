import { z } from "zod";
import { listIn, pageOut } from "@/lib/http";

/** Create a task. */
export const TaskCreateIn = z.object({
  title: z.string().min(1).max(500),
  spaceKey: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  projectId: z.string().optional(),
  sectionId: z.string().optional(),
  parentId: z.string().optional(),
  dueDate: z.string().optional(),
  startDate: z.string().optional(),
  roleNeeded: z.string().optional(),
  kind: z.string().optional(),
  assigneeEmail: z.string().optional(),
});

/** Create result. */
export const TaskCreateOut = z.object({
  id: z.string(),
  identifier: z.string(),
  userId: z.string().nullable(),
});

/** Task row for list/get. */
export const TaskOut = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  priority: z.number(),
  estimate: z.number().nullable(),
  status: z.string(),
  spaceId: z.string(),
  projectId: z.string().nullable(),
  sectionId: z.string().nullable(),
  parentId: z.string().nullable(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  roleNeeded: z.string().nullable(),
});

/** Patch fields. */
export const TaskUpdateIn = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().int().optional(),
  estimate: z.number().int().nullable().optional(),
  status: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  roleNeeded: z.string().nullable().optional(),
});

/** List query. */
export const TaskListIn = listIn(
  { mode: "offset" },
  {
    spaceKey: z.string().optional(),
    projectId: z.string().optional(),
    status: z.string().optional(),
  },
);

/** List page. */
export const TaskListOut = pageOut(TaskOut);

/** Assign body. */
export const AssignIn = z.object({
  id: z.string().min(1),
  assigneeEmail: z.string().min(1),
});

/** Move body. */
export const MoveIn = z.object({
  id: z.string().min(1),
  projectId: z.string().optional(),
  sectionId: z.string().optional(),
  spaceKey: z.string().optional(),
});

/** Depend body. */
export const DependIn = z.object({
  id: z.string().min(1),
  blocksTaskId: z.string().min(1),
});

/** Tag body. */
export const TagIn = z.object({
  id: z.string().min(1),
  tagId: z.string().min(1),
});
