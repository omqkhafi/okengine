import { on, flow, http, fail, table } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  db,
  issueWrite,
  issuesWriteRate,
  keelWorkspace,
  member,
  publicAppUrl,
  snoozeKv,
} from "@/core";
import { cycles, issues, issueLabels, labels, teams, workflowStates } from "@/db/schema.decl";
import { IdIn, Ok } from "@/lib/shapes";
import {
  AssignIn,
  CycleClosed,
  Duplicate,
  IssueCreateIn,
  IssueCreateOut,
  IssueListIn,
  IssueListOut,
  IssueOut,
  IssueUpdateIn,
  LabelIn,
  MergeIn,
  MoveIn,
  NotFound,
  SnoozeIn,
} from "./shapes";
import { issueArchived, issueCreated, issueReassigned, issueUpdated } from "./signals";

import "./signals";

type IssueRow = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  stateId: string;
  teamId: string;
  projectId: string | null;
  cycleId: string | null;
  assigneeEmail: string | null;
  archivedAt: string | null;
};

function asIssue(row: Record<string, unknown>): IssueRow {
  return {
    id: String(row.id),
    identifier: String(row.identifier),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    priority: Number(row.priority),
    estimate: row.estimate == null ? null : Number(row.estimate),
    stateId: String(row.stateId),
    teamId: String(row.teamId),
    projectId: row.projectId == null ? null : String(row.projectId),
    cycleId: row.cycleId == null ? null : String(row.cycleId),
    assigneeEmail: row.assigneeEmail == null ? null : String(row.assigneeEmail),
    archivedAt: row.archivedAt == null ? null : String(row.archivedAt),
  };
}

const WRITE = [member, issueWrite, issuesWriteRate] as const;

const zLabelPath = z.object({
  id: z.string().min(1),
  labelId: z.string().min(1),
});

type CreatedIssue = { id: string; identifier: string; userId: string | null };

/** Create an issue, emit `issue-created`. */
export const create = on(
  http.post("/issues").gate(...WRITE),
  flow("issues.create", {
    in: IssueCreateIn,
    out: IssueCreateOut,
    errors: { CycleClosed, Duplicate, NotFound },
    do: async (input, fx) => {
      const teamRows = await fx.store(db).select().from(teams);
      const team = teamRows.find((r) => String(r.key) === input.teamKey);
      if (!team) return fail("NotFound", { id: input.teamKey });

      if (input.cycleId) {
        const cycle = await fx.store(db).findById(cycles, input.cycleId);
        if (cycle && String(cycle.state) === "completed") {
          return fail("CycleClosed", { cycleId: input.cycleId });
        }
      }

      const existing = await fx.store(db).select().from(issues);
      const prefix = `${input.teamKey}-`;
      const next =
        existing
          .map((r) => String(r.identifier))
          .filter((id) => id.startsWith(prefix))
          .map((id) => Number(id.slice(prefix.length)))
          .filter((n) => Number.isFinite(n))
          .reduce((max, n) => Math.max(max, n), 0) + 1;
      const identifier = `${input.teamKey}-${next}`;
      if (existing.some((r) => String(r.identifier) === identifier)) {
        return fail("Duplicate", { identifier });
      }

      const states = await fx.store(db).select().from(workflowStates);
      const backlog =
        states.find(
          (s) => String(s.teamId) === String(team.id) && String(s.type) === "unstarted",
        ) ?? states.find((s) => String(s.teamId) === String(team.id));

      const id = fx.id();
      await fx
        .store(db)
        .insert(issues)
        .values({
          id,
          identifier,
          title: input.title,
          description: input.description ?? "",
          priority: input.priority ?? 0,
          estimate: null,
          stateId: backlog ? String(backlog.id) : "st_eng_todo",
          teamId: String(team.id),
          projectId: input.projectId ?? null,
          milestoneId: null,
          cycleId: input.cycleId ?? null,
          parentId: null,
          assigneeEmail: input.assigneeEmail ?? null,
          creatorEmail: fx.auth.userId ?? null,
          dueDate: null,
          slaBreachesAt: null,
          triagedAt: null,
          archivedAt: null,
        });
      await fx.emit(
        issueCreated,
        {
          id,
          identifier,
          title: input.title,
          assigneeEmail: input.assigneeEmail ?? null,
        },
        { key: id },
      );
      return { id, identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Patch issue fields. */
export const update = on(
  http.patch("/issues/:id").gate(...WRITE),
  flow("issues.update", {
    in: IssueUpdateIn,
    out: IssueOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.stateId !== undefined) patch.stateId = input.stateId;
      if (input.estimate !== undefined) patch.estimate = input.estimate;
      if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
      if (Object.keys(patch).length > 0) {
        await fx.store(db).update(issues).set(patch).where(eq(issues.id, input.id));
      }
      const next = await fx.store(db).findById(issues, input.id);
      const issue = asIssue(next as Record<string, unknown>);
      await fx.emit(issueUpdated, {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        assigneeEmail: issue.assigneeEmail,
      });
      return issue;
    },
  }),
);

/** List issues (live). */
export const list = on(
  http.get("/issues").gate(member).live(),
  flow("issues.list", {
    in: IssueListIn,
    out: IssueListOut,
    do: async (input, fx) => {
      await fx.vault.get(publicAppUrl);
      await fx.vault.get(keelWorkspace);
      const rows = await fx.store(db).select().from(issues);
      let items = rows.map((r) => asIssue(r as Record<string, unknown>));
      if (input.teamKey) {
        const teamRows = await fx.store(db).select().from(teams);
        const team = teamRows.find((t) => String(t.key) === input.teamKey);
        if (team) items = items.filter((i) => i.teamId === String(team.id));
      }
      if (input.q) {
        const q = input.q.toLowerCase();
        items = items.filter(
          (i) => i.title.toLowerCase().includes(q) || i.identifier.toLowerCase().includes(q),
        );
      }
      const limit = input.limit ?? 25;
      const offset = input.offset ?? 0;
      const page = items.slice(offset, offset + limit);
      return { items: page, count: page.length, total: items.length, limit, offset };
    },
  }),
);

/** Fetch one issue. */
export const get = on(
  http.get("/issues/:id").gate(member),
  flow("issues.get", {
    in: IdIn,
    out: IssueOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      return asIssue(row as Record<string, unknown>);
    },
  }),
);

/** Soft-archive. */
export const archive = on(
  http.post("/issues/:id/archive").gate(...WRITE),
  flow("issues.archive", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const archivedAt = new Date(fx.clock.now()).toISOString();
      await fx.store(db).update(issues).set({ archivedAt }).where(eq(issues.id, input.id));
      const issue = asIssue(row as Record<string, unknown>);
      await fx.emit(issueArchived, {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        assigneeEmail: issue.assigneeEmail,
      });
      return { ok: true as const };
    },
  }),
);

/** Clear archive. */
export const unarchive = on(
  http.post("/issues/:id/unarchive").gate(...WRITE),
  flow("issues.unarchive", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).update(issues).set({ archivedAt: null }).where(eq(issues.id, input.id));
      return { ok: true as const };
    },
  }),
);

/** Assign an issue and notify. */
export const assign = on(
  http.post("/issues/:id/assign").gate(...WRITE),
  flow("issues.assign", {
    in: AssignIn,
    out: IssueCreateOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      // Member emails are `.pii()` — select() masks them, so assign by address.
      await fx
        .store(db)
        .update(issues)
        .set({ assigneeEmail: input.assigneeEmail })
        .where({ id: input.id } as never);
      const issue = asIssue(row as Record<string, unknown>);
      await fx.emit(issueReassigned, {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        assigneeEmail: input.assigneeEmail,
        email: input.assigneeEmail,
      });
      return { id: issue.id, identifier: issue.identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Subscribe (channel confirmation). */
export const subscribe = on(
  http.post("/issues/:id/subscribe").gate(member),
  flow("issues.subscribe", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return { ok: true as const };
      return { ok: true as const };
    },
  }),
);

/** Unsubscribe. */
export const unsubscribe = on(
  http.post("/issues/:id/unsubscribe").gate(member),
  flow("issues.unsubscribe", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      await fx.store(db).findById(issues, input.id);
      return { ok: true as const };
    },
  }),
);

/** Duplicate via `issues.create`. */
export const duplicate = on(
  http.post("/issues/:id/duplicate").gate(...WRITE),
  flow("issues.duplicate", {
    in: IdIn,
    out: IssueCreateOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const issue = asIssue(row as Record<string, unknown>);
      const teamRows = await fx.store(db).select().from(teams);
      const team = teamRows.find((t) => String(t.id) === issue.teamId);
      const created = (await fx.call(create, {
        title: `${issue.title} (copy)`,
        teamKey: team ? String(team.key) : "ENG",
        priority: issue.priority,
        description: issue.description ?? undefined,
      })) as CreatedIssue;
      return created;
    },
  }),
);

/** Move to another team / project / cycle. */
export const move = on(
  http.post("/issues/:id/move").gate(...WRITE),
  flow("issues.move", {
    in: MoveIn,
    out: IssueCreateOut,
    errors: { NotFound, CycleClosed },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      if (input.cycleId) {
        const cycle = await fx.store(db).findById(cycles, input.cycleId);
        if (cycle && String(cycle.state) === "completed") {
          return fail("CycleClosed", { cycleId: input.cycleId });
        }
      }
      const teamRows = await fx.store(db).select().from(teams);
      const team = teamRows.find((t) => String(t.key) === input.teamKey);
      if (!team) return fail("NotFound", { id: input.teamKey });
      await fx
        .store(db)
        .update(issues)
        .set({
          teamId: String(team.id),
          projectId: input.projectId ?? null,
          cycleId: input.cycleId ?? null,
        })
        .where(eq(issues.id, input.id));
      const issue = asIssue(row as Record<string, unknown>);
      return { id: issue.id, identifier: issue.identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Transfer to another team. */
export const transfer = on(
  http.post("/issues/:id/transfer").gate(...WRITE),
  flow("issues.transfer", {
    in: MoveIn,
    out: IssueCreateOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const teamRows = await fx.store(db).select().from(teams);
      const team = teamRows.find((t) => String(t.key) === input.teamKey);
      if (!team) return fail("NotFound", { id: input.teamKey });
      await fx
        .store(db)
        .update(issues)
        .set({ teamId: String(team.id) })
        .where(eq(issues.id, input.id));
      const issue = asIssue(row as Record<string, unknown>);
      return { id: issue.id, identifier: issue.identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Merge into another issue and archive the source. */
export const merge = on(
  http.post("/issues/:id/merge").gate(...WRITE),
  flow("issues.merge", {
    in: MergeIn,
    out: IssueCreateOut,
    errors: { NotFound, Duplicate },
    do: async (input, fx) => {
      if (input.id === input.intoId) return fail("Duplicate", { id: input.id });
      const row = await fx.store(db).findById(issues, input.id);
      const into = await fx.store(db).findById(issues, input.intoId);
      if (!row || !into) return fail("NotFound", { id: input.id });
      const archivedAt = new Date(fx.clock.now()).toISOString();
      await fx.store(db).update(issues).set({ archivedAt }).where(eq(issues.id, input.id));
      const issue = asIssue(row as Record<string, unknown>);
      await fx.emit(issueArchived, {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        assigneeEmail: issue.assigneeEmail,
      });
      const target = asIssue(into as Record<string, unknown>);
      return { id: target.id, identifier: target.identifier, userId: fx.auth.userId ?? null };
    },
  }),
);

/** Snooze an issue in triage KV. */
export const snooze = on(
  http.post("/issues/:id/snooze").gate(...WRITE),
  flow("issues.snooze", {
    in: SnoozeIn,
    out: Ok,
    do: async (input, fx) => {
      await fx.store(db).findById(issues, input.id);
      await fx.store(snoozeKv).set(input.id, { until: input.until, reason: input.reason ?? "" });
      return { ok: true as const };
    },
  }),
);

/** Attach a label. */
export const addLabel = on(
  http.post("/issues/:id/labels").gate(...WRITE),
  flow("issues.addLabel", {
    in: LabelIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      const label = await fx.store(db).findById(labels, input.labelId);
      if (!row || !label) return fail("NotFound", { id: input.id });
      await fx.store(db).insert(issueLabels).values({
        id: fx.id(),
        issueId: input.id,
        labelId: input.labelId,
      });
      return { ok: true as const };
    },
  }),
);

/** Remove a label. */
export const removeLabel = on(
  http.delete("/issues/:id/labels/:labelId").gate(...WRITE),
  flow("issues.removeLabel", {
    in: zLabelPath,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(issueLabels);
      const hit = rows.find(
        (r) => String(r.issueId) === input.id && String(r.labelId) === input.labelId,
      );
      if (!hit) return fail("NotFound", { id: input.labelId });
      await fx
        .store(db)
        .delete(issueLabels)
        .where(eq(issueLabels.id, String(hit.id)));
      return { ok: true as const };
    },
  }),
);

/** Delete an issue. */
export const remove = on(
  http.delete("/issues/:id").gate(...WRITE),
  flow("issues.delete", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.store(db).delete(issues).where(eq(issues.id, input.id));
      return { ok: true as const };
    },
  }),
);

/** Call-only: reserve the next identifier for a team. */
export const reserveIdentifier = flow("issues.reserveIdentifier", {
  in: z.object({ teamKey: z.string() }),
  out: z.object({ identifier: z.string() }),
  do: async (input, fx) => {
    const existing = await fx.store(db).select().from(issues);
    const prefix = `${input.teamKey}-`;
    const next =
      existing
        .map((r) => String(r.identifier))
        .filter((id) => id.startsWith(prefix))
        .map((id) => Number(id.slice(prefix.length)))
        .filter((n) => Number.isFinite(n))
        .reduce((max, n) => Math.max(max, n), 0) + 1;
    return { identifier: `${input.teamKey}-${next}` };
  },
});

/** Call-only: apply a workflow state. */
export const applyWorkflow = flow("issues.applyWorkflow", {
  in: z.object({ id: z.string(), stateId: z.string() }),
  out: Ok,
  errors: { NotFound },
  do: async (input, fx) => {
    const row = await fx.store(db).findById(issues, input.id);
    const state = await fx.store(db).findById(workflowStates, input.stateId);
    if (!row || !state) return fail("NotFound", { id: input.id });
    await fx
      .store(db)
      .update(issues)
      .set({ stateId: input.stateId })
      .where(eq(issues.id, input.id));
    return { ok: true as const };
  },
});

/** CDC — state_id changed. */
export const onStatus = on(
  table("issues").changed("state_id"),
  flow("issues.onStatus", {
    plane: "operator",
    do: async (input, fx) => {
      const id = String((input as { id?: string }).id ?? "");
      if (!id) return;
      const row = await fx.store(db).findById(issues, id);
      if (!row) return;
      await fx
        .store(db)
        .update(issues)
        .set({ stateId: String(row.stateId) })
        .where(eq(issues.id, id));
    },
  }),
);

/** CDC — assignee changed. */
export const onAssignee = on(
  table("issues").changed("assignee_email"),
  flow("issues.onAssignee", {
    plane: "operator",
    do: async (input, fx) => {
      const id = String((input as { id?: string }).id ?? "");
      if (!id) return;
      const row = await fx.store(db).findById(issues, id);
      if (!row) return;
      const issue = asIssue(row as Record<string, unknown>);
      if (!issue.assigneeEmail) return;
      await fx.emit(issueReassigned, {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        assigneeEmail: issue.assigneeEmail,
        email: issue.assigneeEmail,
      });
    },
  }),
);
