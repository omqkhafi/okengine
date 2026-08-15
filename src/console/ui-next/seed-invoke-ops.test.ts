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
    expect(seedInvokeOp("tasks.list")).toBe("list");
    expect(seedInvokeOp("tasks.get")).toBe("get");
    expect(seedInvokeOp("tasks.create")).toBe("create");
    expect(seedInvokeOp("attachments.upload")).toBe("create");
    expect(seedInvokeOp("tasks.update")).toBe("update");
    expect(seedInvokeOp("attachments.delete")).toBe("delete");
    expect(seedInvokeOp("tasks.archive")).toBe("action");
  });
});

describe("primarySqlTable / parentFilter / placeholder", () => {
  test("reads the first sql table from effects", () => {
    expect(primarySqlTable(decl("tasks.list"))).toBe("tasks");
    expect(primarySqlTable(decl("attachments.delete"))).toBe("file_objects");
  });

  test("maps nested collection paths to a parent column", () => {
    expect(parentFilter("/tasks/:id/comments", { id: "tsk_eng_12" })).toEqual({
      column: "task_id",
      value: "tsk_eng_12",
    });
    expect(parentFilter("/attachments/:id", { id: "x" })).toBeNull();
    expect(parentFilter("/tasks/:id/comments", { id: ":id" })).toBeNull();
  });

  test("treats :token as missing", () => {
    expect(isPlaceholderId(":id")).toBe(true);
    expect(isPlaceholderId("")).toBe(true);
    expect(isPlaceholderId("tsk_eng_12")).toBe(false);
  });
});

describe("executeSeedInvoke", () => {
  test("lists real task rows with a total, not an ok echo", async () => {
    const runtime = await seededRuntime();
    try {
      const out = await executeSeedInvoke({
        runtime,
        manifest: UI_NEXT_SEEDED_MANIFEST,
        flowId: "tasks.list",
        path: pathOf("tasks.list"),
        decl: decl("tasks.list"),
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
      expect(data.total).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlTasks);
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
      flowId: "tasks.get",
      path: pathOf("tasks.get"),
      decl: decl("tasks.get"),
      input: { id: "tsk_eng_12" },
      userId: "user_demo",
    });
    expect(get).toMatchObject({
      id: "tsk_eng_12",
      identifier: "ENG-12",
      title: "SSO login fails",
    });

    const updated = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.update",
      path: pathOf("tasks.update"),
      decl: decl("tasks.update"),
      input: { id: "tsk_eng_12", title: "SSO login fails (edited)" },
      userId: "user_demo",
    });
    expect(updated).toMatchObject({
      id: "tsk_eng_12",
      title: "SSO login fails (edited)",
      identifier: "ENG-12",
    });

    const deleted = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "attachments.delete",
      path: pathOf("attachments.delete"),
      decl: decl("attachments.delete"),
      input: { id: "attachments/tsk_eng_12/spec.pdf" },
      userId: "user_demo",
    });
    expect(deleted).toMatchObject({
      ok: true,
      id: "attachments/tsk_eng_12/spec.pdf",
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

  test("create inserts a task and returns the new row", async () => {
    const runtime = await seededRuntime();
    const created = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.create",
      path: pathOf("tasks.create"),
      decl: decl("tasks.create"),
      input: { title: "From Call API", spaceKey: "ENG", priority: 1 },
      userId: "user_demo",
    });
    expect(created).toMatchObject({
      title: "From Call API",
      space_id: "space_eng",
      creator_email: "user_demo",
    });
    expect(typeof (created as { id: string }).id).toBe("string");
    expect(String((created as { identifier: string }).identifier)).toMatch(/^ENG-/);

    const again = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.get",
      path: pathOf("tasks.get"),
      decl: decl("tasks.get"),
      input: { id: (created as { id: string }).id },
      userId: "user_demo",
    });
    expect(again).toMatchObject({ title: "From Call API" });
  });

  test("list honors q, spaceKey, limit, offset, and cursor", async () => {
    const runtime = await seededRuntime();
    const filtered = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.list",
      path: pathOf("tasks.list"),
      decl: decl("tasks.list"),
      input: { q: "ENG-12", limit: 10 },
      userId: "user_demo",
    });
    const found = filtered as {
      items: Array<{ id: string; identifier?: string }>;
      total: number;
      nextCursor?: string;
    };
    expect(found.items.some((row) => row.id === "tsk_eng_12")).toBe(true);
    expect(found.total).toBeLessThan(UI_NEXT_SEED_STORE_COUNTS.sqlTasks);
    expect(found.nextCursor).toBeUndefined();

    const page1 = (await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.list",
      path: pathOf("tasks.list"),
      decl: decl("tasks.list"),
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
      flowId: "tasks.list",
      path: pathOf("tasks.list"),
      decl: decl("tasks.list"),
      input: { limit: 5, cursor: page1.nextCursor, orderBy: "id", order: "asc" },
      userId: "user_demo",
    })) as { items: Array<{ id: string }>; offset: number };
    expect(page2.offset).toBe(5);
    expect(page2.items).toHaveLength(5);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);

    const eng = (await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.list",
      path: pathOf("tasks.list"),
      decl: decl("tasks.list"),
      input: { spaceKey: "ENG", limit: 20 },
      userId: "user_demo",
    })) as { items: Array<{ space_id?: string }>; total: number };
    expect(eng.items.length).toBeGreaterThan(0);
    expect(eng.items.every((row) => row.space_id === "space_eng")).toBe(true);
    expect(encodeListCursor(5)).toBe(page1.nextCursor);
  });

  test("archive returns the updated task, not ok-only", async () => {
    const runtime = await seededRuntime();
    const archived = await executeSeedInvoke({
      runtime,
      manifest: UI_NEXT_SEEDED_MANIFEST,
      flowId: "tasks.archive",
      path: pathOf("tasks.archive"),
      decl: decl("tasks.archive"),
      input: { id: "tsk_eng_12" },
      userId: "user_demo",
    });
    expect(archived).toMatchObject({
      ok: true,
      id: "tsk_eng_12",
      identifier: "ENG-12",
    });
    expect(typeof (archived as { archived_at: string }).archived_at).toBe("string");
  });
});
