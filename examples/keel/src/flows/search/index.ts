import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, issueIndex, member, openaiKey, publicDocsUrl } from "@/core";
import { comments, issues } from "@/db/schema.decl";
import { Ok } from "@/lib/shapes";
import { commentAdded } from "@/flows/comments/signals";
import { issueCreated, issueUpdated } from "@/flows/issues/signals";

const SearchIn = z.object({
  q: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

const SearchOut = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string(), identifier: z.string() })),
  count: z.number(),
});

async function upsertIssue(
  fx: {
    store: typeof import("@/core").db extends infer _D
      ? (ref: unknown) => {
          driverId?: string;
          upsert: (...args: never[]) => Promise<void>;
        }
      : never;
  },
  row: Record<string, unknown>,
): Promise<void> {
  const idx = fx.store(issueIndex) as {
    driverId: string;
    upsert: (id: string, doc: unknown, meta?: Record<string, unknown>) => Promise<void>;
  };
  const id = String(row.id);
  const meta = {
    title: String(row.title),
    identifier: String(row.identifier),
  };
  if (idx.driverId === "meilisearch") {
    await idx.upsert(id, { id, ...meta, description: String(row.description ?? "") });
  } else {
    await idx.upsert(id, [0, 0, 0], meta);
  }
}

/** QUERY search — index first, SQL fallback. */
export const query = on(
  http.query("/search").gate(member),
  flow("search.query", {
    in: SearchIn,
    out: SearchOut,
    do: async (input, fx) => {
      await fx.vault.get(publicDocsUrl);
      const idx = fx.store(issueIndex) as {
        driverId: string;
        search: (q: unknown, opts?: { limit?: number }) => Promise<unknown>;
      };
      const limit = input.limit ?? 25;
      if (idx.driverId === "meilisearch") {
        const result = (await idx.search(input.q, { limit })) as {
          hits?: ReadonlyArray<{ id: string; title?: string; identifier?: string }>;
        };
        const items = (result.hits ?? []).map((h) => ({
          id: String(h.id),
          title: String(h.title ?? ""),
          identifier: String(h.identifier ?? ""),
        }));
        return { items, count: items.length };
      }
      const rows = await fx.store(db).select().from(issues);
      const q = input.q.toLowerCase();
      const items = rows
        .filter(
          (r) =>
            String(r.title).toLowerCase().includes(q) ||
            String(r.identifier).toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map((r) => ({
          id: String(r.id),
          title: String(r.title),
          identifier: String(r.identifier),
        }));
      return { items, count: items.length };
    },
  }),
);

/** Suggest from the index. */
export const suggest = on(
  http.get("/search/suggest").gate(member),
  flow("search.suggest", {
    in: z.object({ q: z.string().optional(), limit: z.number().int().optional() }),
    out: SearchOut,
    do: async (input, fx) => {
      if (!input.q) return { items: [], count: 0 };
      return (await fx.call(query, { q: input.q, limit: input.limit ?? 8 })) as {
        items: { id: string; title: string; identifier: string }[];
        count: number;
      };
    },
  }),
);

/** Reindex every issue. */
export const reindex = on(
  http.post("/search/reindex").gate(member),
  flow("search.reindex", {
    plane: "operator",
    durable: true,
    out: Ok,
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(issues);
      for (const row of rows) {
        await fx.call(embedIssue, { id: String(row.id) });
      }
      return { ok: true as const };
    },
  }),
);

/** Index one issue (call-only). */
export const embedIssue = flow("search.embedIssue", {
  plane: "operator",
  in: z.object({ id: z.string() }),
  out: Ok,
  do: async (input, fx) => {
    await fx.vault.get(openaiKey);
    const row = await fx.store(db).findById(issues, input.id);
    if (!row) return fail("NotFound", { id: input.id });
    await upsertIssue(fx as never, row as Record<string, unknown>);
    return { ok: true as const };
  },
});

/** On create → index. */
export const indexOnCreate = on(
  issueCreated,
  flow("search.index", {
    plane: "operator",
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(issues, payload.id);
      if (row) await upsertIssue(fx as never, row as Record<string, unknown>);
    },
  }),
);

/** On update → index. */
export const onUpdated = on(
  issueUpdated,
  flow("search.onUpdated", {
    plane: "operator",
    do: async (payload, fx) => {
      const row = await fx.store(db).findById(issues, payload.id);
      if (row) await upsertIssue(fx as never, row as Record<string, unknown>);
    },
  }),
);

/** On comment → touch the issue index. */
export const onComment = on(
  commentAdded,
  flow("search.onComment", {
    plane: "operator",
    do: async (payload, fx) => {
      await fx.store(db).findById(comments, payload.id);
      const row = await fx.store(db).findById(issues, payload.issueId);
      if (row) await upsertIssue(fx as never, row as Record<string, unknown>);
    },
  }),
);
