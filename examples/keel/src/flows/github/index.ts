import { on, flow, http, every } from "okengine";
import { z } from "zod";

import { githubToken, member, teamAdmin } from "@/core";
import { Ok } from "@/lib/shapes";
import { create as createIssue } from "@/flows/issues/index";

const IngestIn = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  teamKey: z.string().optional(),
});

/** Stub GitHub webhook — reads vault, creates an issue. No outbound HTTP. */
export const ingest = on(
  http.post("/integrations/github").gate(member),
  flow("github.ingest", {
    plane: "user",
    durable: true,
    in: IngestIn,
    out: z.object({ id: z.string(), identifier: z.string() }),
    do: async (input, fx) => {
      await fx.vault.get(githubToken);
      const created = (await fx.call(createIssue, {
        title: input.title ?? "GitHub issue",
        teamKey: input.teamKey ?? "ENG",
        description: input.body,
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
  http.delete("/integrations/github").gate(member, teamAdmin),
  flow("github.disconnect", {
    out: Ok,
    do: async (_input, fx) => {
      await fx.vault.get(githubToken);
      return { ok: true as const };
    },
  }),
);

/** Stub sync — creates a synthetic issue. */
export const sync = on(
  http.post("/integrations/github/sync").gate(member),
  flow("github.sync", {
    durable: true,
    out: Ok,
    do: async (_input, fx) => {
      await fx.vault.get(githubToken);
      await fx.call(createIssue, {
        title: "GitHub sync",
        teamKey: "ENG",
        description: "Stub sync — no live GitHub API.",
      });
      return { ok: true as const };
    },
  }),
);

/** Periodic reconcile (stub). */
export const reconcile = on(
  every("6h"),
  flow("github.reconcile", {
    plane: "operator",
    do: async (_input, fx) => {
      await fx.call(sync, {});
    },
  }),
);
