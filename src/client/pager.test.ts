import { describe, expect, test } from "bun:test";
import { createClient } from "./create.ts";
import type { AppOf, ClientListMeta } from "./types.ts";

type NotesApp = AppOf<{
  notes: {
    list: {
      in: { limit?: number; cursor?: string };
      out: Array<{ id: string }>;
      errors: Record<string, never>;
    };
  };
}>;

describe("client list pager", () => {
  test("page.next() and for-await walk without checking mode", async () => {
    const pages = [
      {
        data: [{ id: "n_1" }],
        error: null,
        meta: { next: { cursor: "p2" }, prev: null, limit: 1 },
      },
      {
        data: [{ id: "n_2" }],
        error: null,
        meta: { next: null, prev: { cursor: "p1" }, limit: 1 },
      },
    ];
    const seen: unknown[] = [];
    const api = createClient<NotesApp>("http://app.test", {
      fetch: async (_url, init) => {
        const raw = init && "body" in init && typeof init.body === "string" ? init.body : "{}";
        seen.push(raw);
        const input = JSON.parse(raw) as { cursor?: string };
        const body = input.cursor === "p2" ? pages[1]! : pages[0]!;
        return Response.json(body);
      },
    });

    const first = await api.notes.list({ limit: 1 });
    expect(first.error).toBeNull();
    expect(first.data).toEqual([{ id: "n_1" }]);
    const meta: ClientListMeta | undefined = first.error === null ? first.meta : undefined;
    expect(meta?.next).toEqual({ cursor: "p2" });
    expect(meta?.prev).toBeNull();
    const second = await first.next();
    expect(second.data).toEqual([{ id: "n_2" }]);
    const empty = await second.next();
    expect(empty.data).toEqual([]);
    expect(empty.error).toBeNull();
    const back = await second.prev();
    expect(back.data).toEqual([{ id: "n_1" }]);

    const collected: string[] = [];
    for await (const page of api.notes.list({ limit: 1 })) {
      for (const row of page.data ?? []) collected.push(row.id);
    }
    expect(collected).toEqual(["n_1", "n_2"]);

    const fromPage: string[] = [];
    for await (const page of await api.notes.list({ limit: 1 })) {
      for (const row of page.data ?? []) fromPage.push(row.id);
    }
    expect(fromPage).toEqual(["n_1", "n_2"]);
  });
});
