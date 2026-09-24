/**
 * Label export shape and tenant rejection.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Redacted } from "../../../kernel/redacted.ts";
import { exportDecisionLabelsFile } from "../../../cli/decide.ts";
import { DECISION_EXPORT_WARNING, decisionExportFields, exportDecisionLabels } from "./export.ts";

const schema = z.object({
  ticket: z.string(),
  token: z.string().describe("secret"),
  note: z.string().describe("redacted"),
});

describe("decision label export", () => {
  test("keeps declared fields, masks secret markers, and groups expect", () => {
    const fields = decisionExportFields(schema);
    expect(fields.fields).toEqual(["ticket", "token", "note"]);
    expect(fields.secretFields).toEqual(["token", "note"]);
    const exported = exportDecisionLabels({
      callerTenant: "acme",
      fields,
      labels: [
        {
          decision: "triage",
          question: "team",
          value: "billing",
          propensity: 1,
          reviewer: "ops",
          tenant: "acme",
          locale: "en",
          at: 10,
          input: { ticket: "14", token: "sekret", note: Redacted.of("hidden"), extra: "nope" },
        },
        {
          decision: "triage",
          question: "rank",
          value: "high",
          propensity: 1,
          reviewer: "ops",
          tenant: "acme",
          locale: "en",
          at: 10,
          input: { ticket: "14", token: "sekret" },
        },
        {
          decision: "triage",
          question: "team",
          value: "technical",
          propensity: 1,
          reviewer: "ops",
          tenant: "globex",
          at: 11,
          input: { ticket: "other" },
        },
      ],
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const lines = exported.lines
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            input: Record<string, unknown>;
            expect: Record<string, unknown>;
            locale?: string;
          },
      );
    expect(lines).toEqual([
      {
        input: { ticket: "14", token: "[redacted]", note: "[redacted]" },
        expect: { team: "billing", rank: "high" },
        locale: "en",
      },
    ]);
  });

  test("a different tenant is rejected", () => {
    const exported = exportDecisionLabels({
      callerTenant: "acme",
      requestedTenant: "globex",
      fields: { fields: ["ticket"], secretFields: [] },
      labels: [],
    });
    expect(exported).toEqual({ ok: false, status: 404 });
  });

  test("the command prints that the file contains production data", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-export-"));
    const out = join(root, "labels.jsonl");
    const printed: string[] = [];
    await exportDecisionLabelsFile({
      name: "triage",
      origin: "http://127.0.0.1:6530",
      out,
      write: (text) => {
        printed.push(text);
      },
      fetcher: async () =>
        new Response(
          JSON.stringify({
            lines: `${JSON.stringify({ input: { ticket: "14" }, expect: { team: "billing" } })}\n`,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    });
    expect(printed).toEqual([`${DECISION_EXPORT_WARNING}\n`]);
    expect(await Bun.file(out).text()).toContain('"ticket":"14"');
  });
});
