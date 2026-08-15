import "@/core";
import { notesMutate } from "@/core";

import { oke } from "okengine/http";
import * as routes from "@/flows/generated";

export const app = oke({ name: "notes", gate: { policies: [notesMutate] } }).adopt(routes);

export type App = typeof app;
