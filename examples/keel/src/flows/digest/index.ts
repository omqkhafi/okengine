import { on, flow, every } from "okengine";

import { cycleSummaryPrompt, dailyDigestMail, db, slackWebhook } from "@/core";
import { cycles, issues } from "@/db/schema.decl";

/** Morning inbox + cycle digest. */
export const daily = on(
  every("1d"),
  flow("digest.daily", {
    plane: "operator",
    do: async (_input, fx) => {
      await fx.vault.get(slackWebhook);
      const open = (await fx.store(db).select().from(issues)).filter((r) => r.archivedAt == null);
      await fx.store(db).select().from(cycles);
      let summary = `${open.length} open issues`;
      try {
        const out = await fx.ask(cycleSummaryPrompt, { open: open.length });
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
