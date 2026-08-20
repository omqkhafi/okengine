/**
 * Zod from generated Drizzle tables — `drizzle-orm/zod` select / insert / update.
 *
 * Flow `in` / `out` pick and refine these instead of rewriting columns.
 */

import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import type { ZodType } from "zod";
import { pageOut } from "@/lib/http";
import {
  activity,
  comments,
  custom_field_values,
  custom_fields,
  documents,
  file_objects,
  form_submissions,
  forms,
  goals,
  inbox,
  members,
  project_updates,
  projects,
  recurrence,
  sections,
  spaces,
  tags,
  task_assignees,
  task_dependencies,
  task_followers,
  task_tags,
  tasks,
  views,
} from "./schema.drizzle.ts";

/** SQL table name → generated `pgTable`. */
export const drizzleBySqlName = {
  activity,
  comments,
  custom_field_values,
  custom_fields,
  documents,
  file_objects,
  form_submissions,
  forms,
  goals,
  inbox,
  members,
  project_updates,
  projects,
  recurrence,
  sections,
  spaces,
  tags,
  task_assignees,
  task_dependencies,
  task_followers,
  task_tags,
  tasks,
  views,
} as const;

/** One generated Drizzle table. */
export type DrizzleTable = (typeof drizzleBySqlName)[keyof typeof drizzleBySqlName];

/**
 * Select / insert / update Zod for a generated table.
 *
 * @param table - `pgTable` from {@link schema.drizzle.ts}
 */
export function tableZod<T extends DrizzleTable>(table: T) {
  return {
    select: createSelectSchema(table as never),
    insert: createInsertSchema(table as never),
    update: createUpdateSchema(table as never),
  };
}

export const activityZod = tableZod(activity);
export const commentsZod = tableZod(comments);
export const customFieldValuesZod = tableZod(custom_field_values);
export const customFieldsZod = tableZod(custom_fields);
export const documentsZod = tableZod(documents);
export const fileObjectsZod = tableZod(file_objects);
export const formSubmissionsZod = tableZod(form_submissions);
export const formsZod = tableZod(forms);
export const goalsZod = tableZod(goals);
export const inboxZod = tableZod(inbox);
export const membersZod = tableZod(members);
export const projectUpdatesZod = tableZod(project_updates);
export const projectsZod = tableZod(projects);
export const recurrenceZod = tableZod(recurrence);
export const sectionsZod = tableZod(sections);
export const spacesZod = tableZod(spaces);
export const tagsZod = tableZod(tags);
export const taskAssigneesZod = tableZod(task_assignees);
export const taskDependenciesZod = tableZod(task_dependencies);
export const taskFollowersZod = tableZod(task_followers);
export const taskTagsZod = tableZod(task_tags);
export const tasksZod = tableZod(tasks);
export const viewsZod = tableZod(views);

/**
 * Flow `out` for a list — the `data` array. Pagination lives in HTTP `meta`.
 *
 * @param item - Element schema
 */
export function listPage<T extends ZodType>(item: T) {
  return pageOut(item);
}
