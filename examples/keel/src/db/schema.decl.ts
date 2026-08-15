import { store, field, id } from "okengine";

/**
 * Linear-shaped keel domain — abstract declarations, emitted to
 * `src/db/schema.drizzle.ts` by `oke db` / `oke dev`.
 */

export const teams = store.schema.table("teams", {
  id: field.text().primaryKey().defaultFn(id),
  key: field.text().notNull(),
  name: field.text().notNull(),
  parentId: field.text(),
});

export const members = store.schema.table("members", {
  id: field.text().primaryKey().defaultFn(id),
  teamId: field.text().notNull(),
  name: field.text().notNull(),
  email: field.text().notNull().pii(),
  role: field.text().notNull(),
});

export const workflowStates = store.schema.table("workflow_states", {
  id: field.text().primaryKey().defaultFn(id),
  teamId: field.text().notNull(),
  name: field.text().notNull(),
  type: field.text().notNull(),
  position: field.integer().notNull(),
});

export const labels = store.schema.table("labels", {
  id: field.text().primaryKey().defaultFn(id),
  teamId: field.text(),
  name: field.text().notNull(),
  groupName: field.text(),
});

export const initiatives = store.schema.table("initiatives", {
  id: field.text().primaryKey().defaultFn(id),
  name: field.text().notNull(),
  status: field.text().notNull(),
  ownerEmail: field.text().pii(),
  targetDate: field.text(),
});

export const projects = store.schema.table("projects", {
  id: field.text().primaryKey().defaultFn(id),
  initiativeId: field.text().notNull(),
  name: field.text().notNull(),
  status: field.text().notNull(),
  leadEmail: field.text().pii(),
  targetDate: field.text(),
  progress: field.integer().notNull(),
});

export const projectMilestones = store.schema.table("project_milestones", {
  id: field.text().primaryKey().defaultFn(id),
  projectId: field.text().notNull(),
  name: field.text().notNull(),
  targetDate: field.text(),
  sortOrder: field.integer().notNull(),
});

export const projectUpdates = store.schema.table("project_updates", {
  id: field.text().primaryKey().defaultFn(id),
  projectId: field.text().notNull(),
  health: field.text().notNull(),
  body: field.text().notNull(),
  authorEmail: field.text().pii(),
});

export const cycles = store.schema.table("cycles", {
  id: field.text().primaryKey().defaultFn(id),
  teamId: field.text().notNull(),
  number: field.integer().notNull(),
  name: field.text().notNull(),
  startsAt: field.text().notNull(),
  endsAt: field.text().notNull(),
  state: field.text().notNull(),
});

export const issues = store.schema.table("issues", {
  id: field.text().primaryKey().defaultFn(id),
  identifier: field.text().notNull(),
  title: field.text().notNull(),
  description: field.text(),
  priority: field.integer().notNull(),
  estimate: field.integer(),
  stateId: field.text().notNull(),
  teamId: field.text().notNull(),
  projectId: field.text(),
  milestoneId: field.text(),
  cycleId: field.text(),
  parentId: field.text(),
  assigneeEmail: field.text().pii(),
  creatorEmail: field.text().pii(),
  dueDate: field.text(),
  slaBreachesAt: field.text(),
  triagedAt: field.text(),
  archivedAt: field.text(),
});

export const issueLabels = store.schema.table("issue_labels", {
  id: field.text().primaryKey().defaultFn(id),
  issueId: field.text().notNull(),
  labelId: field.text().notNull(),
});

export const comments = store.schema.table("comments", {
  id: field.text().primaryKey().defaultFn(id),
  issueId: field.text().notNull(),
  authorEmail: field.text().pii(),
  body: field.text().notNull(),
  resolvedAt: field.text(),
});

export const documents = store.schema.table("documents", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  body: field.text().notNull(),
  parentKind: field.text().notNull(),
  parentId: field.text().notNull(),
});

export const fileObjects = store.schema.table("file_objects", {
  id: field.text().primaryKey().defaultFn(id),
  objectKey: field.text().notNull(),
  originalName: field.text().notNull(),
  contentType: field.text().notNull(),
  sizeBytes: field.integer().notNull(),
  storeRef: field.text().notNull(),
});

export const customerRequests = store.schema.table("customer_requests", {
  id: field.text().primaryKey().defaultFn(id),
  issueId: field.text().notNull(),
  customerName: field.text().notNull(),
  body: field.text().notNull(),
});
