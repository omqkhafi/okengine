import { on, flow, http } from "okengine";
import { z } from "zod";
import { triage, support, embed, smart, fast } from "../../ai";
import { member } from "../../gates";
import { db } from "../../core";
import { tickets } from "../../schema";

// ① A prompt call with a provider fallback chain and a validated result
export const createTicket = on(
  http.post("/tickets").gate(member),
  flow({
    in: z.object({ subject: z.string(), body: z.string() }),
    out: z.object({ id: z.string(), urgency: z.string() }),
    do: async (input, fx) => {
      const t = await fx.ask(triage, input, { via: [smart, fast] });
      const id = fx.id();
      await fx
        .store(db)
        .insert(tickets)
        .values({ id, ...input, ...t });
      return { id, urgency: t.urgency };
    },
  }),
);
// effects → writes[sql:tickets] asks[ticket-triage v3] cost[~$0.01] nondeterministic

// ② RAG — retrieve, then answer with streaming tokens
export const askDocs = on(
  http.post("/ask").gate(member).live(),
  flow({
    in: z.object({ question: z.string() }),
    do: async ({ question }, fx) => {
      const context = await fx.search(embed, question, { topK: 5 });
      return fx.stream(smart, { prompt: "answer-with-context", data: { question, context } });
      // streaming reaches the client through the Signal element — no separate socket layer
    },
  }),
);

// ③ A durable, bounded agent
export const supportAgent = on(
  http.post("/support").gate(member),
  flow({
    durable: true, // nondeterministic calls are ALWAYS journaled
    in: z.object({ message: z.string() }),
    do: ({ message }, fx) => fx.run(support, { message }),
    // the agent can only call getBooking and refundBooking, and only within THIS user's
    // gates and tenant scope — it cannot exceed what the code declares
  }),
);
