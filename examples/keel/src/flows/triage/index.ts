import { on, flow, http, fail } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  db,
  issueTriagePrompt,
  member,
  mentionReplyMail,
  openaiKey,
  snoozeKv,
  triageAccept,
} from "@/core";
import { issues, workflowStates } from "@/db/schema.decl";
import { IdIn, IdOut, NotFound, Ok, Unavailable } from "@/lib/shapes";
import { issueReassigned } from "@/flows/issues/signals";

const ListIn = z.object({
  q: z.string().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});

/** Triage inbox — issues in a triage state, minus snoozed. */
export const inbox = on(
  http.get("/triage").gate(member).live(),
  flow("triage.inbox", {
    in: ListIn,
    out: z.object({
      items: z.array(z.object({ id: z.string(), title: z.string(), identifier: z.string() })),
      count: z.number(),
    }),
    do: async (input, fx) => {
      const states = await fx.store(db).select().from(workflowStates);
      const triageIds = new Set(
        states.filter((s) => String(s.type) === "triage").map((s) => String(s.id)),
      );
      const rows = await fx.store(db).select().from(issues);
      const snoozed = new Set(await fx.store(snoozeKv).list());
      let items = rows
        .filter((r) => triageIds.has(String(r.stateId)) && !snoozed.has(String(r.id)))
        .map((r) => ({
          id: String(r.id),
          title: String(r.title),
          identifier: String(r.identifier),
        }));
      if (input.q) {
        const q = input.q.toLowerCase();
        items = items.filter(
          (i) => i.title.toLowerCase().includes(q) || i.identifier.toLowerCase().includes(q),
        );
      }
      const limit = input.limit ?? 25;
      const offset = input.offset ?? 0;
      const page = items.slice(offset, offset + limit);
      return { items: page, count: items.length };
    },
  }),
);

/** Accept out of triage into backlog/todo. */
export const accept = on(
  http.post("/triage/:id/accept").gate(member, triageAccept),
  flow("triage.accept", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const states = await fx.store(db).select().from(workflowStates);
      const next =
        states.find(
          (s) => String(s.teamId) === String(row.teamId) && String(s.type) === "unstarted",
        ) ?? states.find((s) => String(s.teamId) === String(row.teamId));
      const triagedAt = new Date(fx.clock.now()).toISOString();
      await fx
        .store(db)
        .update(issues)
        .set({ stateId: next ? String(next.id) : String(row.stateId), triagedAt })
        .where(eq(issues.id, input.id));
      return { ok: true as const };
    },
  }),
);

/** AI suggest — fails Unavailable without a model. */
export const suggest = on(
  http.post("/triage/:id/suggest").gate(member),
  flow("triage.suggest", {
    in: IdIn,
    out: z.object({ summary: z.string(), state: z.string(), priority: z.number() }),
    errors: { NotFound, Unavailable },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      await fx.vault.get(openaiKey);
      try {
        const out = await fx.ask(issueTriagePrompt, {
          title: String(row.title),
          description: String(row.description ?? ""),
        });
        const rec = out && typeof out === "object" ? (out as Record<string, unknown>) : {};
        const summary = typeof rec.summary === "string" ? rec.summary : "";
        if (!summary) {
          return fail("Unavailable", { message: "AI service unavailable. Try again later." });
        }
        await fx.send(mentionReplyMail, {
          to: "ops@keel.dev",
          data: { id: input.id, issueId: input.id, body: summary },
        });
        return {
          summary,
          state: typeof rec.state === "string" ? rec.state : "todo",
          priority: typeof rec.priority === "number" ? rec.priority : 3,
        };
      } catch {
        return fail("Unavailable", { message: "AI service unavailable. Try again later." });
      }
    },
  }),
);

/** Snooze from the inbox. */
export const snooze = on(
  http.post("/triage/:id/snooze").gate(member),
  flow("triage.snooze", {
    in: z.object({ id: z.string(), until: z.string(), reason: z.string().optional() }),
    out: Ok,
    do: async (input, fx) => {
      await fx.store(db).findById(issues, input.id);
      await fx.store(snoozeKv).set(input.id, { until: input.until, reason: input.reason ?? "" });
      return { ok: true as const };
    },
  }),
);

/** Decline (cancel) a triage issue. */
export const decline = on(
  http.post("/triage/:id/decline").gate(member, triageAccept),
  flow("triage.decline", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return { ok: true as const };
      const states = await fx.store(db).select().from(workflowStates);
      const canceled = states.find(
        (s) => String(s.teamId) === String(row.teamId) && String(s.type) === "canceled",
      );
      if (canceled) {
        await fx
          .store(db)
          .update(issues)
          .set({ stateId: String(canceled.id) })
          .where(eq(issues.id, input.id));
      }
      return { ok: true as const };
    },
  }),
);

/** Claim a triage issue. */
export const claim = on(
  http.post("/triage/:id/claim").gate(member, triageAccept),
  flow("triage.claim", {
    in: IdIn,
    out: IdOut,
    do: async (input, fx) => {
      const row = await fx.store(db).findById(issues, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const email = fx.auth.userId ?? "aria@keel.dev";
      await fx.store(db).update(issues).set({ assigneeEmail: email }).where(eq(issues.id, input.id));
      await fx.emit(issueReassigned, {
        id: input.id,
        identifier: String(row.identifier),
        title: String(row.title),
        assigneeEmail: email,
        email,
      });
      return { id: input.id };
    },
  }),
);
