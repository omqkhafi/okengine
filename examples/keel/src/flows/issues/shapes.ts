import { z } from "zod";
import { CycleClosed, Duplicate, IdOut, NotFound } from "@/lib/shapes";

export { CycleClosed, Duplicate, NotFound };

/** Create an issue. */
export const IssueCreateIn = z.object({
  title: z.string().min(1).max(400),
  teamKey: z.string().min(1).max(16),
  priority: z.number().int().min(0).max(4).optional(),
  description: z.string().max(20_000).optional(),
  projectId: z.string().optional(),
  cycleId: z.string().optional(),
  assigneeEmail: z.string().email().optional(),
});

/** Created issue. */
export const IssueCreateOut = z.object({
  id: z.string(),
  identifier: z.string(),
  userId: z.string().nullable(),
});

/** Patch an issue. */
export const IssueUpdateIn = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(400).optional(),
  description: z.string().max(20_000).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  stateId: z.string().optional(),
  estimate: z.number().int().optional(),
  dueDate: z.string().optional(),
});

/** One issue row. */
export const IssueOut = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  estimate: z.number().nullable(),
  stateId: z.string(),
  teamId: z.string(),
  projectId: z.string().nullable(),
  cycleId: z.string().nullable(),
  assigneeEmail: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

/** List / search query. */
export const IssueListIn = z.object({
  q: z.string().optional(),
  teamKey: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Page of issues. */
export const IssueListOut = z.object({
  items: z.array(IssueOut),
  count: z.number(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/** Assign an issue. */
export const AssignIn = z.object({
  id: z.string().min(1),
  assigneeEmail: z.string().min(1),
});

/** Move / transfer. */
export const MoveIn = z.object({
  id: z.string().min(1),
  teamKey: z.string().min(1),
  projectId: z.string().optional(),
  cycleId: z.string().optional(),
});

/** Merge into another issue. */
export const MergeIn = z.object({
  id: z.string().min(1),
  intoId: z.string().min(1),
});

/** Snooze triage. */
export const SnoozeIn = z.object({
  id: z.string().min(1),
  until: z.string().min(1),
  reason: z.string().optional(),
});

/** Add a label. */
export const LabelIn = z.object({
  id: z.string().min(1),
  labelId: z.string().min(1),
});

export const IssueIdOut = IdOut;
