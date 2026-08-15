import { on, flow, http } from "okengine";
import { z } from "zod";

import { githubToken, member, projectAdminWrite } from "@/core";
import { Ok } from "@/lib/shapes";
import { create as createTask } from "@/flows/tasks/index";
import { TaskCreateOut } from "@/flows/tasks/shapes";

const IngestIn = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  spaceKey: z.string().optional(),
});

/** Stub GitHub webhook — reads vault, creates a task. No outbound HTTP. */
export const ingest = on(
  http.post("/integrations/github").gate(member),
  flow("github.ingest", {
    plane: "user",
    durable: true,
    in: IngestIn,
    out: TaskCreateOut.pick({ id: true, identifier: true }),
    do: async (input, fx) => {
      await fx.vault.get(githubToken);
      const created = (await fx.call(createTask, {
        title: input.title ?? "GitHub issue",
        spaceKey: input.spaceKey ?? "ENG",
        description: input.body,
        roleNeeded: "developer",
      })) as { id: string; identifier: string };
      return { id: created.id, identifier: created.identifier };
    },
  }),
);

/** Connection status from whether the token is set. */
export const status = on(
  http.get("/integrations/github").gate(member),
  flow("github.status", {
    out: z.object({ connected: z.boolean(), repo: z.string().optional() }),
    do: async (_input, fx) => {
      const token = await fx.vault.get(githubToken);
      const connected = token.reveal().length > 0;
      return { connected, repo: connected ? "keel/app" : undefined };
    },
  }),
);

/** Stub disconnect. */
export const disconnect = on(
  http.delete("/integrations/github").gate(projectAdminWrite),
  flow("github.disconnect", {
    out: Ok,
    do: async (_input, fx) => {
      await fx.vault.get(githubToken);
      return { ok: true as const };
    },
  }),
);
