import { oke } from "okengine";
import "./flows/notes";

export const app = oke({ name: "notes" });

export type App = typeof app;   // ← the client needs nothing else
