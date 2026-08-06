import { gate } from "okengine";

/**
 * Starter keeps HTTP public. Replace with real policies when you add auth:
 *
 * ```ts
 * export const canWriteNotes = gate.policy("notes:write", ({ auth }) =>
 *   auth.scopes.has("notes:write"),
 * );
 * ```
 */
export const notesWrite = gate.policy("notes:write", () => true);
