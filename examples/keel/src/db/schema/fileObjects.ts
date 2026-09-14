import { field, store } from "okengine";

/** Uploaded file metadata (bytes live in the files store). */
export const fileObjects = store.schema.table("file_objects", {
  id: field.id().primaryKey(),
  objectKey: field.text().notNull(),
  originalName: field.text().notNull(),
  contentType: field.text().notNull(),
  sizeBytes: field.integer().notNull(),
  storeRef: field.text().notNull(),
});
