import "@/core";
import "@/flows/generated";

import { oke } from "okengine/http";

export const app = oke({ name: "notes" });

export type App = typeof app;
