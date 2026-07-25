import { store } from "okengine";
import * as schema from "./schema";

export const db = store.sql("app", { schema });
