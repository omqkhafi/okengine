import { on, flow, http } from "okengine";
import { triage } from "../../ai.ts";
import { member } from "../../gates.ts";
import { db } from "../../core.ts";
import { tickets } from "../../schema.ts";

export const createTicket = on(
  http.post("/tickets").gate(member),
  flow({
    name: "support.createTicket",
    pii: "masked",
    cost: { estimatePerCall: 0.011, budget: 0.02 },
    do: async (input, fx) => {
      const t = await fx.ask(triage, input);
      const id = fx.id();
      await fx.store(db).insert(tickets).values({ id, ...input, ...t });
      return { id, urgency: t.urgency };
    },
  }),
);
