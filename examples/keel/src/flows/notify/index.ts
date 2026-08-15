import { on, flow } from "okengine";

import {
  cycleDigestMail,
  dailyDigestMail,
  db,
  issueAssignedMail,
  issueSubscribedMail,
  mentionReplyMail,
  projectUpdateMail,
} from "@/core";
import { comments, cycles, issues, members, projects } from "@/db/schema.decl";
import { commentAdded } from "@/flows/comments/signals";
import { cycleClosed } from "@/flows/cycles/signals";
import { issueArchived, issueCreated, issueReassigned, issueUpdated } from "@/flows/issues/signals";
import { projectUpdated } from "@/flows/projects/signals";

/** On issue create → assignee email. */
export const onIssue = on(
  issueCreated,
  flow("notify.onIssue", {
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(issues, payload.id);
      const email = payload.assigneeEmail ?? (row ? String(row.assigneeEmail ?? "") : "");
      if (!email) return;
      await fx.send(issueAssignedMail, {
        to: email,
        data: {
          id: payload.id,
          identifier: payload.identifier,
          title: payload.title,
          email,
        },
      });
    },
  }),
);

/** On comment → mention reply. */
export const onComment = on(
  commentAdded,
  flow("notify.onComment", {
    do: async (payload, fx) => {
      await fx.store(db).findById(comments, payload.id);
      await fx.send(mentionReplyMail, {
        to: "ops@keel.dev",
        data: { id: payload.id, issueId: payload.issueId, body: payload.body },
      });
    },
  }),
);

/** On issue update. */
export const onUpdated = on(
  issueUpdated,
  flow("notify.onUpdated", {
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(issues, payload.id);
      const email = row ? String(row.assigneeEmail ?? "") : "";
      if (!email) return;
      await fx.send(issueAssignedMail, {
        to: email,
        data: {
          id: payload.id,
          identifier: payload.identifier,
          title: payload.title,
          email,
        },
      });
    },
  }),
);

/** On archive. */
export const onArchived = on(
  issueArchived,
  flow("notify.onArchived", {
    do: async (payload, fx) => {
      await fx.send(projectUpdateMail, {
        to: "ops@keel.dev",
        data: { projectId: payload.id, name: payload.title, health: "archived" },
      });
    },
  }),
);

/** On reassign. */
export const onAssigned = on(
  issueReassigned,
  flow("notify.onAssigned", {
    do: async (payload, fx) => {
      await fx.store(db).findById(issues, payload.id);
      await fx.send(issueAssignedMail, {
        to: payload.email,
        data: {
          id: payload.id,
          identifier: payload.identifier,
          title: payload.title,
          email: payload.email,
        },
      });
      await fx.send(issueSubscribedMail, {
        to: payload.email,
        data: { id: payload.id, identifier: payload.identifier },
      });
    },
  }),
);

/** On cycle close → digest email. */
export const onCycle = on(
  cycleClosed,
  flow("notify.onCycle", {
    do: async (payload, fx) => {
      await fx.store(db).findById(cycles, payload.cycleId);
      await fx.send(cycleDigestMail, {
        to: "ops@keel.dev",
        data: {
          cycleId: payload.cycleId,
          name: payload.name,
          leftover: payload.leftover,
          summary: payload.summary,
        },
      });
    },
  }),
);

/** On project update. */
export const onProject = on(
  projectUpdated,
  flow("notify.onProject", {
    do: async (payload, fx) => {
      await fx.store(db).findById(projects, payload.projectId);
      await fx.send(projectUpdateMail, {
        to: "ops@keel.dev",
        data: {
          projectId: payload.projectId,
          name: payload.name,
          health: payload.health ?? "updated",
        },
      });
    },
  }),
);

/** On member invite — morning digest ping. */
export const onMember = flow("notify.onMember", {
  do: async (_payload, fx) => {
    const people = await fx.store(db).select().from(members);
    await fx.send(dailyDigestMail, {
      to: "ops@keel.dev",
      data: { open: people.length, at: fx.clock.now() },
    });
  },
});
