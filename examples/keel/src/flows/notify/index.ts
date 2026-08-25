import { on, flow, type Fx } from "okengine";

import { db, formReceivedMail, goalAtRiskMail, mentionReplyMail, taskAssignedMail } from "@/core";
import { comments, inbox, taskAssignees } from "@/db/schema.decl";
import { commentAdded } from "@/flows/comments/signals";
import { draftExpired } from "@/flows/drafts/signals";
import { formSubmitted } from "@/flows/forms/signals";
import { goalAtRisk, goalChanged } from "@/flows/goals/signals";
import { projectUpdated } from "@/flows/projects/signals";
import { taskChanged, taskCompleted } from "@/flows/tasks/signals";

async function pushInbox(
  fx: Fx,
  memberEmail: string,
  kind: string,
  title: string,
  refId: string,
): Promise<void> {
  if (!memberEmail) return;
  await fx
    .store(db)
    .insert(inbox)
    .values({
      id: fx.id(),
      memberEmail,
      kind,
      title,
      refId,
      readAt: null,
      createdAt: new Date(fx.clock.now()).toISOString(),
    });
}

/** On task change → assignee email + inbox. */
export const onTask = on(
  taskChanged,
  flow("notify.onTask", {
    do: async (payload, fx) => {
      const email = payload.assigneeEmail;
      if (!email) return;
      await fx.send(taskAssignedMail, {
        to: email,
        data: {
          id: payload.id,
          identifier: payload.identifier,
          title: payload.title,
          email,
        },
      });
      await pushInbox(fx, email, "task-created", payload.title, payload.id);
    },
  }),
);

/** On comment → mention reply + inbox. */
export const onComment = on(
  commentAdded,
  flow("notify.onComment", {
    do: async (payload, fx) => {
      await fx.store(db).findById(comments, payload.id);
      const mentions = payload.body.match(/@([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi) ?? [];
      const to = mentions[0]?.slice(1) ?? "ops@keel.dev";
      await fx.send(mentionReplyMail, {
        to,
        data: { id: payload.id, taskId: payload.taskId, body: payload.body },
      });
      await pushInbox(fx, to, "mention", payload.body.slice(0, 80), payload.taskId);
    },
  }),
);

/** On form submit → intake mail + inbox. */
export const onForm = on(
  formSubmitted,
  flow("notify.onForm", {
    do: async (payload, fx) => {
      await fx.send(formReceivedMail, {
        to: "ops@keel.dev",
        data: {
          formId: payload.formId,
          taskId: payload.taskId,
          customerName: payload.customerName,
        },
      });
      await pushInbox(fx, "aria@keel.dev", "form-submitted", payload.customerName, payload.taskId);
    },
  }),
);

/** On goal at-risk → mail. */
export const onGoal = on(
  goalAtRisk,
  flow("notify.onGoal", {
    do: async (payload, fx) => {
      await fx.send(goalAtRiskMail, {
        to: "ops@keel.dev",
        data: {
          goalId: payload.goalId,
          name: payload.name,
          status: payload.status,
        },
      });
    },
  }),
);

/** On goal change → ops inbox. */
export const onGoalChanged = on(
  goalChanged,
  flow("notify.onGoalChanged", {
    do: async (payload, fx) => {
      await pushInbox(fx, "ops@keel.dev", "goal-changed", payload.name, payload.goalId);
    },
  }),
);

/** On task complete → assignee inbox. */
export const onComplete = on(
  taskCompleted,
  flow("notify.onComplete", {
    do: async (payload, fx) => {
      const rows = await fx.store(db).select().from(taskAssignees);
      const email =
        rows.find((r) => String(r.taskId) === payload.id)?.assigneeEmail ?? "ops@keel.dev";
      await pushInbox(fx, String(email), "task-completed", payload.title, payload.id);
    },
  }),
);

/** On project health/archive → lead inbox. */
export const onProject = on(
  projectUpdated,
  flow("notify.onProject", {
    do: async (payload, fx) => {
      await pushInbox(
        fx,
        payload.actorEmail ?? "ops@keel.dev",
        "project-updated",
        payload.name,
        payload.projectId,
      );
    },
  }),
);

/** On draft expire → ops inbox. */
export const onDraft = on(
  draftExpired,
  flow("notify.onDraft", {
    do: async (payload, fx) => {
      await pushInbox(fx, "ops@keel.dev", "draft-expired", payload.id, payload.id);
    },
  }),
);
