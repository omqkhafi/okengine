/**
 * Featured Harbor story + Console-scale volume + built-in vault stubs.
 * Run with `oke db seed` (never at boot).
 */

import { join } from "node:path";
import { defineSeed, type Fx } from "okengine";
import {
  commentIndex,
  db,
  documentIndex,
  draftsKv,
  keelFiles,
  projectIndex,
  remindersKv,
  taskIndex,
} from "@/core";
import {
  activity,
  comments,
  customFields,
  customFieldValues,
  documents,
  fileObjects,
  formSubmissions,
  forms,
  goals,
  inbox,
  members,
  projectUpdates,
  projects,
  recurrence,
  sections,
  spaces,
  tags,
  taskAssignees,
  taskDependencies,
  taskFollowers,
  taskTags,
  tasks,
  views,
} from "@/db/schema.decl";
import {
  FEATURED_ACTIVITY,
  FEATURED_ASSIGNEES,
  FEATURED_COMMENTS,
  FEATURED_DEPS,
  FEATURED_DOCUMENTS,
  FEATURED_DRAFTS,
  FEATURED_FIELDS,
  FEATURED_FIELD_VALUES,
  FEATURED_FILES,
  FEATURED_FOLLOWERS,
  FEATURED_FORMS,
  FEATURED_GOALS,
  FEATURED_INBOX,
  FEATURED_INDEX,
  FEATURED_MEMBERS,
  FEATURED_PROJECTS,
  FEATURED_RECURRENCE,
  FEATURED_REMINDERS,
  FEATURED_SECTIONS,
  FEATURED_SPACES,
  FEATURED_SUBMISSIONS,
  FEATURED_TAGS,
  FEATURED_TASKS,
  FEATURED_TASK_TAGS,
  FEATURED_UPDATES,
  FEATURED_VIEWS,
} from "./featured.ts";
import { seedKeelVault } from "./vault.ts";
import {
  KEEL_VOLUME,
  type SeedFileEntry,
  type SeedIndexEntry,
  type SeedKvEntry,
} from "./volume.ts";

const UPSERT = { onExisting: "update" as const };

async function upsertRows(
  fx: Fx,
  table: unknown,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  const sql = fx.store(db);
  for (const row of rows) {
    await sql.upsert(table, { id: String(row.id) }, row, UPSERT);
  }
}

/**
 * MIME for a seeded attachment name.
 *
 * @param originalName - File name
 */
function contentTypeForName(originalName: string): string {
  if (originalName.endsWith(".png")) return "image/png";
  if (originalName.endsWith(".pdf")) return "application/pdf";
  return "text/plain";
}

/**
 * Byte length of a seeded payload.
 *
 * @param data - String or bytes
 */
function payloadBytes(data: string | Uint8Array): number {
  return typeof data === "string" ? data.length : data.byteLength;
}

async function seedKv(fx: Fx, drafts: readonly SeedKvEntry[], reminders: readonly SeedKvEntry[]) {
  const draftsHandle = fx.store(draftsKv);
  for (const entry of drafts) {
    await draftsHandle.set(entry.key, entry.value, entry.ttl);
  }
  const reminderHandle = fx.store(remindersKv);
  for (const entry of reminders) {
    await reminderHandle.set(entry.key, entry.value, entry.ttl);
  }
}

async function seedFiles(
  fx: Fx,
  entries: ReadonlyArray<{ key: string; originalName: string; data: string | Uint8Array }>,
): Promise<void> {
  const files = fx.store(keelFiles);
  for (const entry of entries) {
    await files.put(entry.key, entry.data);
  }
  await upsertRows(
    fx,
    fileObjects,
    entries.map((entry) => ({
      id: entry.key,
      objectKey: entry.key,
      originalName: entry.originalName,
      contentType: contentTypeForName(entry.originalName),
      sizeBytes: payloadBytes(entry.data),
      storeRef: keelFiles.ref,
    })),
  );
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === "string" ? value : "";
}

function indexVector(i: number): readonly [number, number, number] {
  return [i % 3 === 0 ? 1 : 0, i % 3 === 1 ? 1 : 0, i % 3 === 2 ? 1 : 0];
}

function toIndexEntry(id: string, i: number, meta: Record<string, unknown>): SeedIndexEntry {
  return { id, vector: indexVector(i), meta };
}

async function seedIndex(
  fx: Fx,
  decl: typeof taskIndex,
  entries: readonly SeedIndexEntry[],
): Promise<void> {
  const idx = fx.store(decl);
  for (const entry of entries) {
    if (idx.driverId === "meilisearch") {
      await idx.upsert(entry.id, {
        id: entry.id,
        title: metaString(entry.meta, "title"),
        identifier: metaString(entry.meta, "identifier"),
        description: metaString(entry.meta, "description"),
        body: metaString(entry.meta, "body"),
        name: metaString(entry.meta, "name"),
      });
    } else {
      await idx.upsert(entry.id, entry.vector, entry.meta);
    }
  }
}

/** Spaces, members, tags — every env. */
async function workspace(fx: Fx) {
  await upsertRows(fx, spaces, FEATURED_SPACES);
  await upsertRows(fx, members, FEATURED_MEMBERS);
  await upsertRows(fx, tags, FEATURED_TAGS);
}

/** Built-in vault stubs — `dev` only. Other apps leave Vault empty. */
async function vault(_fx: Fx) {
  await seedKeelVault({ root: join(import.meta.dir, "../../..") });
}

/** Featured story + generated volume — `dev` only. */
async function volume(fx: Fx) {
  await upsertRows(fx, members, KEEL_VOLUME.members);
  await upsertRows(fx, goals, FEATURED_GOALS);
  await upsertRows(fx, projects, [...FEATURED_PROJECTS, ...KEEL_VOLUME.projects]);
  await upsertRows(fx, sections, [...FEATURED_SECTIONS, ...KEEL_VOLUME.sections]);
  await upsertRows(fx, customFields, FEATURED_FIELDS);
  await upsertRows(fx, tasks, [...FEATURED_TASKS, ...KEEL_VOLUME.tasks]);
  await upsertRows(fx, taskAssignees, [...FEATURED_ASSIGNEES, ...KEEL_VOLUME.assignees]);
  await upsertRows(fx, taskFollowers, [...FEATURED_FOLLOWERS, ...KEEL_VOLUME.followers]);
  await upsertRows(fx, taskDependencies, [...FEATURED_DEPS, ...KEEL_VOLUME.deps]);
  await upsertRows(fx, taskTags, [...FEATURED_TASK_TAGS, ...KEEL_VOLUME.taskTags]);
  await upsertRows(fx, customFieldValues, FEATURED_FIELD_VALUES);
  await upsertRows(fx, comments, [...FEATURED_COMMENTS, ...KEEL_VOLUME.comments]);
  await upsertRows(fx, documents, [...FEATURED_DOCUMENTS, ...KEEL_VOLUME.documents]);
  await upsertRows(fx, projectUpdates, FEATURED_UPDATES);
  await upsertRows(fx, views, [...FEATURED_VIEWS, ...KEEL_VOLUME.views]);
  await upsertRows(fx, forms, FEATURED_FORMS);
  await upsertRows(fx, formSubmissions, [...FEATURED_SUBMISSIONS, ...KEEL_VOLUME.submissions]);
  await upsertRows(fx, inbox, [...FEATURED_INBOX, ...KEEL_VOLUME.inbox]);
  await upsertRows(fx, activity, [...FEATURED_ACTIVITY, ...KEEL_VOLUME.activity]);
  await upsertRows(fx, recurrence, FEATURED_RECURRENCE);

  const allFiles: ReadonlyArray<SeedFileEntry | (typeof FEATURED_FILES)[number]> = [
    ...FEATURED_FILES,
    ...KEEL_VOLUME.files,
  ];
  await seedFiles(fx, allFiles);
  await seedKv(
    fx,
    [...FEATURED_DRAFTS, ...KEEL_VOLUME.drafts],
    [...FEATURED_REMINDERS, ...KEEL_VOLUME.reminders],
  );
  await seedIndex(fx, taskIndex, [...FEATURED_INDEX, ...KEEL_VOLUME.index]);
  await seedIndex(fx, documentIndex, [
    ...FEATURED_DOCUMENTS.map((row, i) =>
      toIndexEntry(row.id, i, { title: row.title, parentKind: row.parentKind }),
    ),
    ...KEEL_VOLUME.documents.map((row, i) =>
      toIndexEntry(row.id, FEATURED_DOCUMENTS.length + i, {
        title: row.title,
        parentKind: row.parentKind,
      }),
    ),
  ]);
  await seedIndex(fx, commentIndex, [
    ...FEATURED_COMMENTS.map((row, i) =>
      toIndexEntry(row.id, i, { taskId: row.taskId, body: row.body }),
    ),
    ...KEEL_VOLUME.comments.map((row, i) =>
      toIndexEntry(row.id, FEATURED_COMMENTS.length + i, {
        taskId: row.taskId,
        body: row.body,
      }),
    ),
  ]);
  await seedIndex(fx, projectIndex, [
    ...FEATURED_PROJECTS.map((row, i) =>
      toIndexEntry(row.id, i, { name: row.name, status: row.status }),
    ),
    ...KEEL_VOLUME.projects.map((row, i) =>
      toIndexEntry(row.id, FEATURED_PROJECTS.length + i, {
        name: row.name,
        status: row.status,
      }),
    ),
  ]);
}

export default defineSeed({
  name: "keel",
  description: "Featured Harbor GA story + volume + vault stubs",
  essential: workspace,
  dev: [vault, volume],
});
