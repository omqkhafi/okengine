import { on, flow } from "okengine";

import { dailyDigestClock, dailyDigestMail, db, slackWebhook, weeklySummaryPrompt } from "@/core";
import { goals, tasks } from "@/db/schema.decl";

/** Morning inbox + goal digest — named clock `daily-digest`. */
export const daily = on(
  dailyDigestClock,
  flow("digest.daily", {
    plane: "operator",
    do: async (_input, fx) => {
      await fx.vault.get(slackWebhook);
      const open = (await fx.store(db).select().from(tasks)).filter(
        (r) => r.archivedAt == null && r.completedAt == null,
      );
      await fx.store(db).select().from(goals);
      let summary = `${open.length} open tasks`;
      try {
        const out = await fx.ask(weeklySummaryPrompt, { open: open.length });
        if (out && typeof out === "object" && "summary" in out) {
          summary = String((out as { summary: unknown }).summary);
        }
      } catch {
        // keep fallback
      }
      void summary;
      await fx.send(dailyDigestMail, {
        to: "ops@keel.dev",
        data: { open: open.length, at: fx.clock.now() },
      });
    },
  }),
);
