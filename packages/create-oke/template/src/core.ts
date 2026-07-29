import { store } from "okengine";
import * as schema from "./schema.decl";

export const db = store.sql("app", { schema });
