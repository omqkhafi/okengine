/**
 * Unit tests for the shared ui-next Console seed (Playwright + seeded Vite).
 */

import { describe, expect, test } from "bun:test";
import {
  applyUiNextSeedVaultEnv,
  createUiNextOperationRuns,
  createUiNextSeedRun,
  createUiNextSeedRuns,
  isConsoleSeeded,
  seedUiNextStoreData,
  UI_NEXT_SEED_CYCLES_RUN_ID,
  UI_NEXT_SEED_DRAFTS_RUN_ID,
  UI_NEXT_SEED_FAIL_RUN_ID,
  UI_NEXT_SEED_FEATURED_COUNT,
  UI_NEXT_SEED_INGEST_RUN_ID,
  UI_NEXT_SEED_NOTIFY_RUN_ID,
  UI_NEXT_SEED_OPERATION_COUNT,
  UI_NEXT_SEED_PUBLIC_APP_URL,
  UI_NEXT_SEED_VAULT_CONFIG,
  UI_NEXT_SEED_VAULT_LAYERS,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEED_STORE_COUNTS,
  UI_NEXT_SEED_TOTAL_COUNT,
  UI_NEXT_SEED_TRIAGE_RUN_ID,
  UI_NEXT_SEEDED_MANIFEST,
  uiNextSeededSummary,
} from "./ui-next-seed.ts";
import { KEEL_SURFACE_FLOWS } from "./ui-next-seed-manifest-surface.ts";

describe("ui-next seed", () => {
  test("manifest declares all eight elements", () => {
    expect(UI_NEXT_SEEDED_MANIFEST.app).toBe("keel");
    expect(UI_NEXT_SEEDED_MANIFEST.flows).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.signals).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.clocks).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.gates).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.vault).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.channels).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.ai).toBeDefined();

    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["triage.suggest"]?.effects?.asks).toContain(
      "issue-triage",
    );
    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["drafts.expire"]?.trigger?.every).toBe("10m");
    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["issues.onStatus"]?.trigger?.cdc).toEqual({
      table: "issues",
      column: "state_id",
    });
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["cache"]?.facet).toBe("kv");
    expect(UI_NEXT_SEEDED_MANIFEST.clocks?.["expire-drafts"]?.every).toBe("10m");
    expect(UI_NEXT_SEEDED_MANIFEST.vault?.["OPENAI_KEY"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.vault?.["GITHUB_TOKEN"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.vault?.["PUBLIC_APP_URL"]).toMatchObject({
      sensitive: false,
      description: "Public Keel origin",
    });
    expect(UI_NEXT_SEEDED_MANIFEST.vault?.["PUBLIC_API_URL"]).toMatchObject({
      sensitive: false,
      description: "Public API origin",
    });
    expect(Object.keys(UI_NEXT_SEEDED_MANIFEST.vault ?? {}).sort()).toEqual([
      "GITHUB_TOKEN",
      "KEEL_WORKSPACE",
      "OPENAI_KEY",
      "PUBLIC_API_URL",
      "PUBLIC_APP_URL",
      "PUBLIC_DOCS_URL",
      "SLACK_BOT",
      "SLACK_WEBHOOK",
      "WEBHOOK_SECRET",
    ]);
    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["issues.list"]?.effects?.secrets).toContain(
      "PUBLIC_APP_URL",
    );
    expect(UI_NEXT_SEEDED_MANIFEST.channels?.["mention-reply"]?.medium).toBe("email");
    expect(UI_NEXT_SEEDED_MANIFEST.ai?.prompts?.["issue-triage"]?.version).toBe(3);
    expect(UI_NEXT_SEEDED_MANIFEST.signals?.["comment-added"]?.delivery).toBe("live");
    expect(UI_NEXT_SEEDED_MANIFEST.signals?.["draft-expired"]?.delivery).toBe("broadcast");
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["attachments"]?.facet).toBe("files");
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["search"]?.facet).toBe("index");
    expect(
      UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["issues"]?.columns?.["assignee_email"],
    ).toMatchObject({ pii: true });
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["teams"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["cycles"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["customer_requests"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["oke_identities"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["oke_sessions"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["oke_crons"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["db"]?.tables?.["oke_vault_secrets"]).toBeDefined();
  });

  test("manifest covers full CRUD, custom routes, and every HTTP verb", () => {
    const flows = UI_NEXT_SEEDED_MANIFEST.flows ?? {};
    const ids = Object.keys(flows);
    expect(ids.length).toBeGreaterThanOrEqual(80);

    for (const id of [
      "issues.get",
      "issues.delete",
      "issues.archive",
      "issues.assign",
      "issues.duplicate",
      "issues.merge",
      "comments.list",
      "comments.update",
      "comments.delete",
      "comments.resolve",
      "projects.list",
      "projects.get",
      "projects.update",
      "projects.delete",
      "documents.list",
      "documents.delete",
      "attachments.list",
      "attachments.delete",
      "teams.list",
      "labels.create",
      "cycles.complete",
      "members.invite",
      "initiatives.list",
      "requests.create",
      "triage.inbox",
      "triage.snooze",
      "search.query",
      "drafts.save",
      "webhooks.rotate",
      "slack.ingest",
      "health.ping",
      "issues.reserveIdentifier",
    ]) {
      expect(flows[id]).toBeDefined();
    }

    const methods = new Set(
      ids
        .map((id) => flows[id]?.trigger?.http?.method)
        .filter((m): m is NonNullable<typeof m> => m != null),
    );
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "QUERY"] as const) {
      expect(methods.has(method)).toBe(true);
    }

    expect(flows["search.query"]?.trigger?.http).toEqual({ method: "QUERY", path: "/search" });
    const listIn = flows["issues.list"]?.in;
    expect(listIn && typeof listIn === "object" ? listIn.properties : null).toMatchObject({
      q: { type: "string" },
      limit: { type: "integer", default: 25 },
      offset: { type: "integer", default: 0 },
      cursor: { type: "string" },
      orderBy: { type: "string" },
      order: { enum: ["asc", "desc"] },
    });
    expect(flows["comments.list"]?.in).toEqual(flows["issues.list"]?.in);
    expect(flows["drafts.save"]?.trigger?.http?.method).toBe("PUT");
    expect(flows["health.ping"]?.trigger?.http?.method).toBe("HEAD");
    expect(flows["issues.reserveIdentifier"]?.trigger).toBeUndefined();
    expect(flows["github.ingest"]?.trigger?.http?.method).toBe("POST");
    expect(UI_NEXT_SEEDED_MANIFEST.signals?.["issue-reassigned"]?.delivery).toBe("live");
    expect(UI_NEXT_SEEDED_MANIFEST.clocks?.["daily-digest"]?.cron).toBe("0 8 * * *");
    expect(UI_NEXT_SEEDED_MANIFEST.vault?.["WEBHOOK_SECRET"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.gates?.["comment:write"]?.kind).toBe("policy");

    const featured = [
      "github.ingest",
      "issues.create",
      "issues.update",
      "issues.list",
      "comments.create",
      "projects.create",
      "documents.upsert",
      "attachments.upload",
      "triage.accept",
      "triage.suggest",
      "notify.onIssue",
      "notify.onComment",
      "search.index",
      "issues.onStatus",
      "cycles.close",
      "drafts.expire",
      "sla.watch",
    ];
    for (const id of featured) {
      expect(KEEL_SURFACE_FLOWS[id]).toBeUndefined();
      expect(flows[id]).toBeDefined();
    }
  });

  test("primary seed run keeps Playwright-stable id and rich ledger", () => {
    const run = createUiNextSeedRun(1_700_000_000_000);
    expect(run.id).toBe(UI_NEXT_SEED_RUN_ID);
    expect(run.flow).toBe("issues.create");
    expect(run.unit).toBe("issues");
    expect(run.parentId).toBe(UI_NEXT_SEED_INGEST_RUN_ID);
    expect(run.tenant).toBe("ws_keel");
    expect(run.gates).toContain("issue:write");
    expect(run.effects.some((e) => e.kind === "emit" && e.resource === "issue-created")).toBe(true);
    expect(run.logs.length).toBeGreaterThan(0);
    expect(run.input).toEqual({
      title: "Pulse graph on selected trace",
      teamKey: "ENG",
      priority: 2,
    });
    expect(run.output).toEqual({ id: "iss_eng_184", identifier: "ENG-184" });
  });

  test("featured runs cover chain + AI + clock elements", () => {
    const runs = createUiNextSeedRuns(1_700_000_000_000);
    expect(runs.length).toBe(UI_NEXT_SEED_TOTAL_COUNT);
    expect(UI_NEXT_SEED_TOTAL_COUNT).toBe(
      UI_NEXT_SEED_FEATURED_COUNT + UI_NEXT_SEED_OPERATION_COUNT,
    );
    expect(UI_NEXT_SEED_TOTAL_COUNT).toBeGreaterThanOrEqual(50);
    expect(UI_NEXT_SEED_TOTAL_COUNT).toBeLessThanOrEqual(100);

    const byId = new Map(runs.map((r) => [r.id, r]));
    const create = byId.get(UI_NEXT_SEED_RUN_ID);
    const notify = byId.get(UI_NEXT_SEED_NOTIFY_RUN_ID);
    const ingest = byId.get(UI_NEXT_SEED_INGEST_RUN_ID);
    const fail = byId.get(UI_NEXT_SEED_FAIL_RUN_ID);
    const triage = byId.get(UI_NEXT_SEED_TRIAGE_RUN_ID);
    const drafts = byId.get(UI_NEXT_SEED_DRAFTS_RUN_ID);
    const cycles = byId.get(UI_NEXT_SEED_CYCLES_RUN_ID);

    expect(ingest?.flow).toBe("github.ingest");
    expect(ingest?.effects.some((e) => e.kind === "call")).toBe(true);
    expect(ingest?.effects.some((e) => e.kind === "secret")).toBe(true);
    expect(create?.parentId).toBe(UI_NEXT_SEED_INGEST_RUN_ID);
    expect(notify?.parentId).toBe(UI_NEXT_SEED_RUN_ID);
    expect(notify?.trigger).toBe("signal");
    expect(notify?.effects.some((e) => e.kind === "send")).toBe(true);
    expect(fail?.error?.code).toBe("CycleClosed");
    expect(fail?.output).toBeUndefined();
    expect(triage?.output).toMatchObject({ replyQueued: true, template: "mention-reply" });
    expect(triage?.effects.some((e) => e.kind === "ask")).toBe(true);
    expect(triage?.effects.some((e) => e.kind === "secret" && e.resource === "OPENAI_KEY")).toBe(
      true,
    );
    expect(triage?.cost).toBeGreaterThan(0);
    expect(drafts?.trigger).toBe("every");
    expect(drafts?.effects.some((e) => e.resource === "kv:drafts")).toBe(true);
    expect(drafts?.effects.some((e) => e.kind === "emit" && e.resource === "draft-expired")).toBe(
      true,
    );
    expect(cycles?.trigger).toBe("cron");
    expect(cycles?.effects.some((e) => e.kind === "emit" && e.resource === "cycle-closed")).toBe(
      true,
    );
  });

  test("operation traffic is deterministic and spans manifest flows", () => {
    const a = createUiNextOperationRuns(1_700_000_000_000);
    const b = createUiNextOperationRuns(1_700_000_000_000);
    expect(a.length).toBe(UI_NEXT_SEED_OPERATION_COUNT);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));

    const flows = new Set(a.map((r) => r.flow));
    expect(flows.has("issues.create")).toBe(true);
    expect(flows.has("issues.list")).toBe(true);
    expect(flows.has("notify.onIssue")).toBe(true);
    expect(flows.has("github.ingest")).toBe(true);
    expect(flows.has("triage.suggest") || flows.has("drafts.expire")).toBe(true);
    expect(
      [...flows].some((id) =>
        ["issues.get", "issues.archive", "issues.assign", "search.query", "drafts.save"].includes(
          id,
        ),
      ),
    ).toBe(true);

    const failed = a.filter(
      (r) => r.error?.code === "CycleClosed" || r.error?.code === "Duplicate",
    );
    expect(failed.length).toBeGreaterThan(0);

    const chained = a.filter((r) => r.parentId?.startsWith("pw-ops-create-"));
    expect(chained.length).toBeGreaterThan(0);
  });

  test("seed vault config is non-sensitive and projects in the clear", async () => {
    const { createManifestVaultRuntime, projectVaultList } = await import("../server/vault.ts");
    const layers = UI_NEXT_SEED_VAULT_LAYERS;
    const runtime = await createManifestVaultRuntime(UI_NEXT_SEEDED_MANIFEST, {
      env: "dev",
      driverId: "memory",
      seed: layers.driver,
      overlays: {
        ...(layers.processEnv !== undefined ? { "process.env": layers.processEnv } : {}),
        ...(layers.envLocal !== undefined ? { ".env.local": layers.envLocal } : {}),
      },
      ...(layers.devFallback !== undefined ? { devFallbacks: layers.devFallback } : {}),
    });
    const listed = await projectVaultList({
      manifest: UI_NEXT_SEEDED_MANIFEST,
      runtime,
      env: "dev",
    });
    const byName = Object.fromEntries(listed.secrets.map((row) => [row.name, row]));
    expect(byName["PUBLIC_APP_URL"]).toMatchObject({
      kind: "config",
      sensitive: false,
      cleartext: UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_APP_URL,
      winner: "process.env",
      readers: ["issues.list"],
    });
    expect(byName["PUBLIC_API_URL"]).toMatchObject({
      kind: "config",
      cleartext: UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_API_URL,
      winner: "driver",
      readers: ["health.ping"],
    });
    expect(byName["PUBLIC_DOCS_URL"]).toMatchObject({
      kind: "config",
      cleartext: UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_DOCS_URL,
      winner: ".env.local",
      readers: ["search.query"],
    });
    expect(byName["KEEL_WORKSPACE"]).toMatchObject({
      kind: "config",
      cleartext: UI_NEXT_SEED_VAULT_CONFIG.KEEL_WORKSPACE,
      winner: "process.env",
      readers: ["issues.list"],
    });
    expect(byName["GITHUB_TOKEN"]).toMatchObject({ kind: "secret", winner: "driver" });
    expect(byName["OPENAI_KEY"]).toMatchObject({ kind: "secret", winner: "driver" });
    expect(byName["WEBHOOK_SECRET"]).toMatchObject({ kind: "secret", winner: "process.env" });
    expect(byName["SLACK_WEBHOOK"]).toMatchObject({ kind: "secret", winner: ".env.local" });
    expect(byName["SLACK_BOT"]).toMatchObject({ kind: "secret", winner: "dev-fallback" });
    expect(listed.secrets).toHaveLength(9);
  });

  test("applyUiNextSeedVaultEnv pins PUBLIC_APP_URL without clobbering", () => {
    const prev = process.env["PUBLIC_APP_URL"];
    try {
      delete process.env["PUBLIC_APP_URL"];
      applyUiNextSeedVaultEnv();
      expect(process.env["PUBLIC_APP_URL"]).toBe(UI_NEXT_SEED_PUBLIC_APP_URL);
      process.env["PUBLIC_APP_URL"] = "https://app.example.com";
      applyUiNextSeedVaultEnv();
      expect(process.env["PUBLIC_APP_URL"]).toBe("https://app.example.com");
    } finally {
      if (prev === undefined) delete process.env["PUBLIC_APP_URL"];
      else process.env["PUBLIC_APP_URL"] = prev;
    }
  });

  test("seeded env flag and summary are explicit", () => {
    const prev = process.env["OKE_CONSOLE_SEEDED"];
    try {
      delete process.env["OKE_CONSOLE_SEEDED"];
      expect(isConsoleSeeded()).toBe(false);
      process.env["OKE_CONSOLE_SEEDED"] = "1";
      expect(isConsoleSeeded()).toBe(true);
      expect(uiNextSeededSummary()).toContain(UI_NEXT_SEED_RUN_ID);
      expect(uiNextSeededSummary()).toContain(String(UI_NEXT_SEED_TOTAL_COUNT));
      expect(uiNextSeededSummary()).toContain("8 elements");
      expect(uiNextSeededSummary()).toContain(`${UI_NEXT_SEED_STORE_COUNTS.sqlIssues} issues`);
    } finally {
      if (prev === undefined) delete process.env["OKE_CONSOLE_SEEDED"];
      else process.env["OKE_CONSOLE_SEEDED"] = prev;
    }
  });

  test("seedUiNextStoreData fills all four facets with non-zero rows", async () => {
    const { createManifestStoreRuntime, queryStore } = await import("../server/store.ts");
    const runtime = await createManifestStoreRuntime(UI_NEXT_SEEDED_MANIFEST);
    try {
      await seedUiNextStoreData(runtime);

      const issues = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "sql:db",
        child: "issues",
        revealPii: true,
        limit: 2000,
      });
      expect(issues.rows?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlIssues);
      expect(UI_NEXT_SEED_STORE_COUNTS.sqlIssues).toBeGreaterThanOrEqual(500);
      expect(issues.rows?.[0]?.assignee_email).toContain("@keel.dev");
      const descriptions = issues.rows?.map((r) => r.description) ?? [];
      expect(descriptions.some((n) => typeof n === "string" && /[؀-ۿ]/.test(n))).toBe(true);

      const teams = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "sql:db",
        child: "teams",
        limit: 2000,
      });
      expect(teams.rows?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlTeams);

      const identities = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "sql:db",
        child: "oke_identities",
        revealPii: true,
        limit: 2000,
      });
      expect(identities.rows?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlIdentities);
      expect(identities.rows?.length).toBeGreaterThan(0);
      expect(identities.rows?.some((r) => r.email === "aria@keel.dev")).toBe(true);

      const crons = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "sql:db",
        child: "oke_crons",
        limit: 2000,
      });
      expect(crons.rows?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlCrons);
      expect(crons.rows?.some((r) => r.name === "expire-drafts")).toBe(true);

      const comments = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "sql:db",
        child: "comments",
        revealPii: true,
        limit: 2000,
      });
      expect(comments.rows?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.sqlComments);
      const bodies = comments.rows?.map((r) => r.body) ?? [];
      expect(bodies.some((n) => typeof n === "string" && /[؀-ۿ]/.test(n))).toBe(true);

      const drafts = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "kv:cache",
        child: "drafts",
        limit: 2000,
      });
      const snooze = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "kv:cache",
        child: "triage-snooze",
        limit: 2000,
      });
      expect((drafts.keys?.length ?? 0) + (snooze.keys?.length ?? 0)).toBe(
        UI_NEXT_SEED_STORE_COUNTS.kvKeys,
      );
      expect(drafts.keys?.every((k) => k.key.startsWith("drafts:"))).toBe(true);
      expect(snooze.keys?.every((k) => k.key.startsWith("triage-snooze:"))).toBe(true);

      const files = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "files:attachments",
        child: "attachments",
        limit: 2000,
      });
      expect(files.keys?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.filesAttachments);

      const index = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "index:search",
        child: "issues",
        vector: [1, 0, 0],
        topK: 80,
      });
      expect(index.hits?.length).toBe(UI_NEXT_SEED_STORE_COUNTS.indexIssues);

      const text = await queryStore(runtime, UI_NEXT_SEEDED_MANIFEST, {
        ref: "index:search",
        child: "issues",
        q: "pulse graph",
        topK: 5,
      });
      expect(text.hits?.[0]?.id).toBe("iss_eng_184");
      expect(text.hits?.[0]?.meta).toMatchObject({ identifier: "ENG-184" });
    } finally {
      await runtime.close();
    }
  });
});
