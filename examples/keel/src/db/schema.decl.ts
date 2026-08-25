import { store, field } from "okengine";

/**
 * Keel work-management domain — Asana / ClickUp / Monday shaped.
 * Abstract declarations, emitted to `src/db/schema.drizzle.ts` by `oke db`.
 */

export const spaces = store.schema.table("spaces", {
  id: field.id().primaryKey(),
  key: field.text().notNull().unique(),
  name: field.text().notNull(),
  color: field.text(),
  createdAt: field.timestamp().notNull().now(),
});

export const members = store.schema.table("members", {
  id: field.id().primaryKey(),
  spaceId: field.text().references(() => spaces.id, { onDelete: "set null" }),
  name: field.text().notNull(),
  email: field.text().notNull().pii(),
  role: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});

export const goals = store.schema.table("goals", {
  id: field.id().primaryKey(),
  name: field.text().notNull(),
  status: field.text().notNull(),
  ownerEmail: field.text().pii(),
  targetDate: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
  updatedAt: field.timestamp().notNull().now(),
});

export const projects = store.schema.table("projects", {
  id: field.id().primaryKey(),
  spaceId: field
    .text()
    .notNull()
    .references(() => spaces.id),
  goalId: field.text().references(() => goals.id, { onDelete: "set null" }),
  name: field.text().notNull(),
  status: field.text().notNull(),
  leadEmail: field.text().pii(),
  startDate: field.timestamp(),
  targetDate: field.timestamp(),
  color: field.text(),
  createdAt: field.timestamp().notNull().now(),
  updatedAt: field.timestamp().notNull().now(),
});

export const sections = store.schema.table("sections", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  sortOrder: field.integer().notNull(),
});

export const tasks = store.schema.table("tasks", {
  id: field.id().primaryKey(),
  identifier: field.text().notNull().unique(),
  title: field.text().notNull(),
  description: field.text(),
  kind: field.text().notNull(),
  priority: field.integer().notNull(),
  estimate: field.integer(),
  status: field.text().notNull(),
  spaceId: field
    .text()
    .notNull()
    .references(() => spaces.id),
  projectId: field.text().references(() => projects.id, { onDelete: "set null" }),
  sectionId: field.text().references(() => sections.id, { onDelete: "set null" }),
  parentId: field.text(),
  startDate: field.timestamp(),
  dueDate: field.timestamp(),
  completedAt: field.timestamp(),
  archivedAt: field.timestamp(),
  creatorEmail: field.text().pii(),
  roleNeeded: field.text(),
  createdAt: field.timestamp().notNull().now(),
  updatedAt: field.timestamp().notNull().now(),
});

export const taskAssignees = store.schema.table("task_assignees", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  assigneeEmail: field.text().notNull(),
});

export const taskFollowers = store.schema.table("task_followers", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  followerEmail: field.text().notNull(),
});

export const taskDependencies = store.schema.table("task_dependencies", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  blocksTaskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
});

export const tags = store.schema.table("tags", {
  id: field.id().primaryKey(),
  name: field.text().notNull(),
  groupName: field.text(),
});

export const taskTags = store.schema.table("task_tags", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  tagId: field
    .text()
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
});

export const customFields = store.schema.table("custom_fields", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  type: field.text().notNull(),
});

export const customFieldValues = store.schema.table("custom_field_values", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  fieldId: field
    .text()
    .notNull()
    .references(() => customFields.id, { onDelete: "cascade" }),
  value: field.text().notNull(),
});

export const comments = store.schema.table("comments", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  authorEmail: field.text().pii(),
  body: field.text().notNull(),
  resolvedAt: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
});

export const activity = store.schema.table("activity", {
  id: field.id().primaryKey(),
  parentKind: field.text().notNull(),
  parentId: field.text().notNull(),
  actorEmail: field.text().pii(),
  kind: field.text().notNull(),
  body: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});

export const documents = store.schema.table("documents", {
  id: field.id().primaryKey(),
  title: field.text().notNull(),
  body: field.text().notNull(),
  parentKind: field.text().notNull(),
  parentId: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});

export const fileObjects = store.schema.table("file_objects", {
  id: field.id().primaryKey(),
  objectKey: field.text().notNull(),
  originalName: field.text().notNull(),
  contentType: field.text().notNull(),
  sizeBytes: field.integer().notNull(),
  storeRef: field.text().notNull(),
});

export const projectUpdates = store.schema.table("project_updates", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  health: field.text().notNull(),
  body: field.text().notNull(),
  authorEmail: field.text().pii(),
  createdAt: field.timestamp().notNull().now(),
});

export const views = store.schema.table("views", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  kind: field.text().notNull(),
  filtersJson: field.text(),
  ownerEmail: field.text().pii(),
  createdAt: field.timestamp().notNull().now(),
});

export const forms = store.schema.table("forms", {
  id: field.id().primaryKey(),
  projectId: field
    .text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: field.text().notNull(),
  schemaJson: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});

export const formSubmissions = store.schema.table("form_submissions", {
  id: field.id().primaryKey(),
  formId: field
    .text()
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  taskId: field.text().references(() => tasks.id, { onDelete: "set null" }),
  payloadJson: field.text().notNull(),
  customerName: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});

export const inbox = store.schema.table("inbox", {
  id: field.id().primaryKey(),
  memberEmail: field.text().notNull(),
  kind: field.text().notNull(),
  title: field.text().notNull(),
  refId: field.text().notNull(),
  readAt: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
});

export const recurrence = store.schema.table("recurrence", {
  id: field.id().primaryKey(),
  taskId: field
    .text()
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  every: field.text().notNull(),
  nextAt: field.timestamp().notNull(),
});

/** RQB v2 relations — keys match emitted Drizzle export names. */
export const keelRelations = store.schema.relations(
  {
    spaces,
    members,
    goals,
    projects,
    sections,
    tasks,
    task_assignees: taskAssignees,
    task_followers: taskFollowers,
    task_dependencies: taskDependencies,
    tags,
    task_tags: taskTags,
    custom_fields: customFields,
    custom_field_values: customFieldValues,
    comments,
    activity,
    documents,
    file_objects: fileObjects,
    project_updates: projectUpdates,
    views,
    forms,
    form_submissions: formSubmissions,
    inbox,
    recurrence,
  },
  (r) => ({
    spaces: {
      members: r.many.members({ from: r.spaces.id, to: r.members.spaceId }),
      projects: r.many.projects({ from: r.spaces.id, to: r.projects.spaceId }),
    },
    members: {
      space: r.one.spaces({ from: r.members.spaceId, to: r.spaces.id }),
    },
    goals: {
      projects: r.many.projects({ from: r.goals.id, to: r.projects.goalId }),
    },
    projects: {
      space: r.one.spaces({ from: r.projects.spaceId, to: r.spaces.id, optional: false }),
      goal: r.one.goals({ from: r.projects.goalId, to: r.goals.id }),
      sections: r.many.sections({ from: r.projects.id, to: r.sections.projectId }),
      tasks: r.many.tasks({ from: r.projects.id, to: r.tasks.projectId }),
      updates: r.many.project_updates({ from: r.projects.id, to: r.project_updates.projectId }),
      views: r.many.views({ from: r.projects.id, to: r.views.projectId }),
      forms: r.many.forms({ from: r.projects.id, to: r.forms.projectId }),
    },
    sections: {
      project: r.one.projects({ from: r.sections.projectId, to: r.projects.id, optional: false }),
      tasks: r.many.tasks({ from: r.sections.id, to: r.tasks.sectionId }),
    },
    tasks: {
      space: r.one.spaces({ from: r.tasks.spaceId, to: r.spaces.id, optional: false }),
      project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }),
      section: r.one.sections({ from: r.tasks.sectionId, to: r.sections.id }),
      parent: r.one.tasks({ from: r.tasks.parentId, to: r.tasks.id }),
      assignees: r.many.task_assignees({ from: r.tasks.id, to: r.task_assignees.taskId }),
      followers: r.many.task_followers({ from: r.tasks.id, to: r.task_followers.taskId }),
      comments: r.many.comments({ from: r.tasks.id, to: r.comments.taskId }),
      tags: r.many.task_tags({ from: r.tasks.id, to: r.task_tags.taskId }),
    },
    task_assignees: {
      task: r.one.tasks({ from: r.task_assignees.taskId, to: r.tasks.id, optional: false }),
    },
    comments: {
      task: r.one.tasks({ from: r.comments.taskId, to: r.tasks.id, optional: false }),
    },
    forms: {
      project: r.one.projects({ from: r.forms.projectId, to: r.projects.id, optional: false }),
      submissions: r.many.form_submissions({ from: r.forms.id, to: r.form_submissions.formId }),
    },
    form_submissions: {
      form: r.one.forms({ from: r.form_submissions.formId, to: r.forms.id, optional: false }),
      task: r.one.tasks({ from: r.form_submissions.taskId, to: r.tasks.id }),
    },
  }),
);
