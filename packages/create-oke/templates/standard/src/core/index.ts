/**
 * Core wiring — stores, gates, vault, channels (and AI when configured).
 */

export { db } from "./store";
export { notesWrite } from "./gates";
export { webhookSecret } from "./vault";
export { noteCreatedMail } from "./channels";

import "./gates";
import "./vault";
import "./channels";
