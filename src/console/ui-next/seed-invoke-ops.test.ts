/**
 * Seed invoke ops — Call API returns store rows, not `{ ok, flow, userId }`.
 */

import { describe, expect, test } from "bun:test";
import { createManifestStoreRuntime } from "../server/store.ts";
import {
  decodeListCursor,
  encodeListCursor,
  executeSeedInvoke,
  isPlaceholderId,
  parentFilter,
  primarySqlTable,
  SEED_INVOKE_LIST_LIMIT,
  seedInvokeOp,
} from "./seed-invoke-ops.ts";
import { UI_NEXT_SEEDED_MANIFEST } from "./ui-next-seed-manifest.ts";
import { seedUiNextStoreData, UI_NEXT_SEED_STORE_COUNTS } from "./ui-next-seed-store.ts";

function decl(flowId: string) {
  const flow = UI_NEXT_SEEDED_MANIFEST.flows?.[flowId];
  if (!flow) throw new Error(`missing flow ${flowId}`);
  return flow;
}

function pathOf(flowId: string): string {
  return decl(flowId).trigger?.http?.path ?? "/";
}

async function seededRuntime() {
  const runtime = await createManifestStoreRuntime(UI_NEXT_SEEDED_MANIFEST);
  await seedUiNextStoreData(runtime);
  return runtime;
}

describe("seedInvokeOp", () => {
  test("classifies CRUD + search", () => {
    expect(seedInvokeOp("issues.list")).toBe("list");
    expect(seedInvokeOp("issues.get")).toBe("get");
    expect(seedInvokeOp("issues.create")).toBe("create");
    expect(seedInvokeOp("attachments.upload")).toBe("create");
    expect(seedInvokeOp("issues.update")).toBe("update");
    expect(seedInvokeOp("attachments.delete")).toBe("delete");
    expect(seedInvokeOp("issues.archive")).toBe("action");
  });
});

describe("primarySqlTable / parentFilter / placeholder", () => {
  test("reads the first sql table from effects", () => {
    expect(primarySqlTable(decl("issues.list"))).toBe("issues");
    expect(primarySqlTable(decl("attachments.delete"))).toBe("file_objects");
  });

  test("maps nested collection paths to a parent column", () => {
    expect(parentFilter("/issues/:id/comments", { id: "iss_eng_184" })).toEqual({
      column: "issue_id",
      value: "iss_eng_184",
    });
    expect(parentFilter("/attachments/:id", { id: "x" })).toBeNull();
    expect(parentFilter("/issues/:id/comments", { id: ":id" })).toBeNull();
  });

  test("treats :token as missing", () => {
    expect(isPlaceholderId(":id")).toBe(true);
    expect(isPlaceholderId("")).toBe(true);
    expect(isPlaceholderId("iss_eng_184")).toBe(false);
  });
});

describe("executeSeedInvoke", () => {
  test("lists real issue rows with a total, not an ok echo", async () => {
    const runtime = await seededRuntime();
    try {
      const out = await executeSeedInvoke({
        runtime,
        manifest: UI_NEXT_SEEDED_MANIFEST,
        flowId: "issues.list",
        path: pathOf("issues.list"),
        decl: decl("issues.list"),
        input: {},
        userId: "user_demo",
      });
      expect(out).not.toHaveProperty("error");
      const data = out as {
        items: Array<{ id: string; identifier?: string }>;
        count: number;
        total: number;
      };
      expect(data.items.length).toBe(SEED_INVOKE_LIST_LIMIT);
      expect(data.count).toBe(SEED_INVOKE_LIST_LIMIT);
      expect(data.total).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlIssues);
      expect((out as { limit: number; offset: number }).limit).toBe(SEED_INVOKE_LIST_LIMIT);
      expect((out as { offset: number }).offset).toBe(0);
      expect(decodeListCursor((out as { nextCursor: string }).nextCursor)).toBe(
        SEED_INVOKE_LIST_LIMIT,
      );
      expect(data.items.every((row) => typeof row.id === "string")).toBe(true);
    } finally {
      /* memory runtime */
    }
  });

  test("get / update / delete return the row that moved", async () => {
    const runtime = await seededRuntime();
    const get = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.get",
      path: pathOf("issues.get"),
      decl: decl("issues.get"),
      input: { id: "iss_eng_184" },
      userId: "user_demo",
    });
    expect(get).toMatchObject({
      id: "iss_eng_184",
      identifier: "ENG-184",
      title: "Pulse graph on selected trace",
    });

    const updated = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.update",
      path: pathOf("issues.update"),
      decl: decl("issues.update"),
      input: { id: "iss_eng_184", title: "Pulse graph (edited)" },
      userId: "user_demo",
    });
    expect(updated).toMatchObject({
      id: "iss_eng_184",
      title: "Pulse graph (edited)",
      identifier: "ENG-184",
    });

    const deleted = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "attachments.delete",
      path: pathOf("attachments.delete"),
      decl: decl("attachments.delete"),
      input: { id: "attachments/ENG-184/spec.pdf" },
      userId: "user_demo",
    });
    expect(deleted).toMatchObject({
      ok: true,
      id: "attachments/ENG-184/spec.pdf",
    });
    expect((deleted as { deleted: { original_name?: string } }).deleted.original_name).toBe(
      "spec.pdf",
    );

    const missing = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "attachments.delete",
      path: pathOf("attachments.delete"),
      decl: decl("attachments.delete"),
      input: { id: ":id" },
      userId: "user_demo",
    });
    expect(missing).toMatchObject({
      data: null,
      error: { code: "NotFound", data: { id: ":id", flow: "attachments.delete" } },
    });
  });

  test("create inserts an issue and returns the new row", async () => {
    const runtime = await seededRuntime();
    const created = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.create",
      path: pathOf("issues.create"),
      decl: decl("issues.create"),
      input: { title: "From Call API", teamKey: "ENG", priority: 1 },
      userId: "user_demo",
    });
    expect(created).toMatchObject({
      title: "From Call API",
      team_id: "team_eng",
      creator_email: "user_demo",
    });
    expect(typeof (created as { id: string }).id).toBe("string");
    expect(String((created as { identifier: string }).identifier)).toMatch(/^ENG-/);

    const again = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.get",
      path: pathOf("issues.get"),
      decl: decl("issues.get"),
      input: { id: (created as { id: string }).id },
      userId: "user_demo",
    });
    expect(again).toMatchObject({ title: "From Call API" });
  });

  test("list honors q, teamKey, limit, offset, and cursor", async () => {
    const runtime = await seededRuntime();
    const filtered = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.list",
      path: pathOf("issues.list"),
      decl: decl("issues.list"),
      input: { q: "ENG-184", limit: 10 },
      userId: "user_demo",
    });
    const found = filtered as {
      items: Array<{ id: string; identifier?: string }>;
      total: number;
      nextCursor?: string;
    };
    expect(found.items.some((row) => row.id === "iss_eng_184")).toBe(true);
    expect(found.total).toBeLessThan(UI_NEXT_SEED_STORE_COUNTS.sqlIssues);
    expect(found.nextCursor).toBeUndefined();

    const page1 = (await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.list",
      path: pathOf("issues.list"),
      decl: decl("issues.list"),
      input: { limit: 5, orderBy: "id", order: "asc" },
      userId: "user_demo",
    })) as {
      items: Array<{ id: string }>;
      nextCursor: string;
      offset: number;
    };
    expect(page1.items).toHaveLength(5);
    expect(page1.offset).toBe(0);
    expect(decodeListCursor(page1.nextCursor)).toBe(5);

    const page2 = (await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.list",
      path: pathOf("issues.list"),
      decl: decl("issues.list"),
      input: { limit: 5, cursor: page1.nextCursor, orderBy: "id", order: "asc" },
      userId: "user_demo",
    })) as { items: Array<{ id: string }>; offset: number };
    expect(page2.offset).toBe(5);
    expect(page2.items).toHaveLength(5);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);

    const eng = (await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.list",
      path: pathOf("issues.list"),
      decl: decl("issues.list"),
      input: { teamKey: "ENG", limit: 20 },
      userId: "user_demo",
    })) as { items: Array<{ team_id?: string }>; total: number };
    expect(eng.items.length).toBeGreaterThan(0);
    expect(eng.items.every((row) => row.team_id === "team_eng")).toBe(true);
    expect(encodeListCursor(5)).toBe(page1.nextCursor);
  });

  test("archive returns the updated issue, not ok-only", async () => {
    const runtime = await seededRuntime();
    const archived = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "issues.archive",
      path: pathOf("issues.archive"),
      decl: decl("issues.archive"),
      input: { id: "iss_eng_184" },
      userId: "user_demo",
    });
    expect(archived).toMatchObject({
      ok: true,
      id: "iss_eng_184",
      identifier: "ENG-184",
    });
    expect(typeof (archived as { archived_at: string }).archived_at).toBe("string");
  });
});
