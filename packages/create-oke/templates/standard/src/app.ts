import "@/core";

import { oke } from "okengine/http";
import * as routes from "@/flows/generated";

export const app = oke({ name: "notes" }).adopt(routes);

export type App = typeof app;
