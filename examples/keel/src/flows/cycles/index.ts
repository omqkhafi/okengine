import { on, flow, http, every, fail } from "okengine";

import { cycleSummaryPrompt, db, member, slackWebhook, teamAdmin } from "@/core";
import { cycles, issues } from "@/db/schema.decl";
import { CycleClosed, IdIn, Ok } from "@/lib/shapes";
import { bindNamedTableCrud } from "@/lib/resource";
import { cycleClosed } from "./signals";

import "./signals";

export const { list, create, get, update, remove } = bindNamedTableCrud({
  unit: "cycles",
  path: "/cycles",
  table: cycles,
  read: [member],
  write: [member, teamAdmin],
  defaults: { state: "upcoming" },
});

/** Close one cycle now. */
export const complete = on(
  http.post("/cycles/:id/close").gate(member, teamAdmin),
  flow("cycles.complete", {
    in: IdIn,
    out: Ok,
    errors: { CycleClosed },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(cycles, input.id);
      if (!row) return fail("CycleClosed", { cycleId: input.id });
      if (String(row.state) === "completed") return fail("CycleClosed", { cycleId: input.id });
      await fx.call(close, { cycleId: input.id });
      return { ok: true as const };
    },
  }),
);

/** Monday rollover — close active cycles, summarize, email digest. */
export const close = on(
  every("7d"),
  flow("cycles.close", {
    plane: "operator",
    do: async (input, fx) => {
      await fx.vault.get(slackWebhook);
      const cycleId = (input as { cycleId?: string } | undefined)?.cycleId;
      const rows = await fx.store(db).select().from(cycles);
      const targets = cycleId
        ? rows.filter((r) => String(r.id) === cycleId)
        : rows.filter((r) => String(r.state) === "active");
      const allIssues = await fx.store(db).select().from(issues);
      for (const cycle of targets) {
        const leftover = allIssues.filter(
          (i) => String(i.cycleId) === String(cycle.id) && i.archivedAt == null,
        ).length;
        await fx
          .store(db)
          .update(cycles)
          .set({ state: "completed" })
          .where({ id: String(cycle.id) } as never);
        let summary = `${String(cycle.name)} closed with ${leftover} leftover.`;
        try {
          const out = await fx.ask(cycleSummaryPrompt, {
            name: String(cycle.name),
            leftover,
          });
          if (out && typeof out === "object" && "summary" in out) {
            summary = String((out as { summary: unknown }).summary);
          }
        } catch {
          // mock / missing model — keep the fallback sentence
        }
        await fx.emit(cycleClosed, {
          cycleId: String(cycle.id),
          leftover,
          name: String(cycle.name),
          summary,
        });
      }
    },
  }),
);
