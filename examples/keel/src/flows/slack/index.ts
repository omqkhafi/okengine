import { on, flow, http } from "okengine";
import { z } from "zod";

import { member, slackBot } from "@/core";

/** Stub Slack ingest — reads vault, creates a task. No outbound HTTP. */
export const ingest = on(
  http.post("/integrations/slack").gate(member),
  flow("slack.ingest", {
    durable: true,
    in: z.object({
      text: z.string().min(1),
      channel: z.string().optional(),
    }),
    out: z.object({ id: z.string() }),
    do: async (input, fx) => {
      await fx.vault.get(slackBot);
      const created = (await fx.call("tasks.create", {
        title: input.text.slice(0, 200),
        spaceKey: "ENG",
        description: input.channel ? `from #${input.channel}` : undefined,
        roleNeeded: "developer",
      })) as { id: string };
      return { id: created.id };
    },
  }),
);
