import { store } from "okengine";
import * as schema from "@/db/schema.decl";

/** App SQL store — tables from {@link schema}. */
export const db = store.sql("app", { schema });

/** Object storage for note attachments (fs locally · s3 in docker). */
export const files = store.files("uploads");
