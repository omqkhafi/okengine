import { signal } from "okengine";
import { z } from "zod";

const IssueRef = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  assigneeEmail: z.string().nullable().optional(),
});

/** Issue created — wake notify + search. */
export const issueCreated = signal("issue-created", {
  delivery: "once",
  retries: 5,
  deadLetter: true,
  schema: IssueRef,
});

/** Issue fields changed — wake search + notify. */
export const issueUpdated = signal("issue-updated", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
  schema: IssueRef,
});

/** Issue archived or merged away. */
export const issueArchived = signal("issue-archived", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: IssueRef,
});

/** Assignee changed — realtime inbox. */
export const issueReassigned = signal("issue-reassigned", {
  delivery: "live",
  retries: 3,
  deadLetter: true,
  schema: IssueRef.extend({ email: z.string() }),
});
