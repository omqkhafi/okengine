/**
 * Keel gate decls — policies, scopes, rates, chains.
 */

import { gate } from "okengine";

/** Signed-in workspace member. */
export const member = gate.policy("member", {
  description: "Signed-in workspace member",
  check: ({ auth }) => !!auth.verified,
});

/** May create and update tasks. */
export const taskWrite = gate.scope("task:write");

/** May create projects, views, and forms. */
export const projectAdmin = gate.scope("project:admin");

/** May edit and resolve comments. */
export const commentWrite = gate.scope("comment:write");

/** May replace or delete attachments. */
export const filesWrite = gate.scope("files:write");

/** May invite and remove members. */
export const memberAdmin = gate.scope("member:admin");

/** May manage outbound webhooks. */
export const webhookAdmin = gate.scope("webhook:admin");

/** Task write throttle. */
export const tasksWriteRate = gate.rate({
  strategy: "sliding-window-counter",
  max: 60,
  per: "1m",
  keyBy: "user",
  description: "Task write throttle",
});

/** Comment write throttle. */
export const commentsWriteRate = gate.rate({
  strategy: "sliding-window-counter",
  max: 120,
  per: "1m",
  keyBy: "user",
  description: "Comment write throttle",
});

/** Form / view mutation throttle. */
export const pmWriteRate = gate.rate({
  strategy: "token-bucket",
  max: 40,
  per: "1m",
  keyBy: "user",
  description: "PM mutation throttle",
});

/** Developer + PM task mutate chain. */
export const tasksWrite = gate.all(member, taskWrite, tasksWriteRate);

/** Comment edit / resolve chain (guests included when they hold the scope). */
export const commentsWrite = gate.all(member, commentWrite, commentsWriteRate);

/** Project / view / form / goal admin write chain. */
export const projectAdminWrite = gate.all(member, projectAdmin, pmWriteRate);

/** Member invite / admin write chain. */
export const memberAdminWrite = gate.all(member, memberAdmin);

/** Webhook admin write chain. */
export const webhookAdminWrite = gate.all(member, webhookAdmin);
