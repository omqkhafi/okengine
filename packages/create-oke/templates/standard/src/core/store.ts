import { store } from "okengine";
import * as schema from "@/db/schema.decl";

/** App SQL store — tables from {@link schema}. */
export const db = store.sql("app", { schema });
