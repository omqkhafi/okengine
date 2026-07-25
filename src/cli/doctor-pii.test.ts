/**
 * Project-wide Manifest PII→ask helpers.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../manifest/types.ts";
import {
  askFieldsForFlow,
  checkManifestPiiAsks,
  collectClassifications,
  providerForAsks,
} from "./doctor-pii.ts";

describe("doctor-pii", () => {
  test("collectClassifications flattens store + table maps", () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "t",
      stores: {
        db: {
          facet: "sql",
          classifications: { "users.phone": { pii: true } },
          tables: {
            users: {
              columns: { email: { pii: true } },
              classifications: { name: ["pii"] },
            },
          },
        },
      },
    };
    const map = collectClassifications(manifest);
    expect(map["users.phone"]).toEqual({ pii: true });
    expect(map["users.email"]).toEqual({ pii: true });
    expect(map.email).toEqual({ pii: true });
    expect(map.name).toEqual(["pii"]);
  });

  test("askFieldsForFlow unions flow.in and prompt.in", () => {
    const fields = askFieldsForFlow(
      {
        in: {
          type: "object",
          properties: { subject: {}, email: {} },
        },
      },
      ["ticket-triage@3"],
      {
        "ticket-triage": {
          in: {
            type: "object",
            properties: { body: {}, email: {} },
          },
        },
      },
    );
    expect(fields).toEqual(["body", "email", "subject"]);
  });

  test("providerForAsks prefers prompt model provider", () => {
    expect(
      providerForAsks(
        ["ticket-triage"],
        { "ticket-triage": { model: "smart" } },
        {
          smart: { provider: "anthropic" },
          fast: { provider: "mock" },
        },
      ),
    ).toBe("anthropic");
  });

  test("checkManifestPiiAsks names the offending flow", () => {
    const findings = checkManifestPiiAsks({
      oke: "1.0",
      app: "t",
      flows: {
        "billing.refund": {
          in: {
            type: "object",
            properties: { email: { type: "string" } },
          },
          effects: { asks: ["summarize"] },
        },
      },
      stores: {
        db: { facet: "sql", classifications: { email: { pii: true } } },
      },
      ai: {
        models: { m: { provider: "openai-compatible" } },
        prompts: { summarize: { model: "m" } },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("pii_ask");
    expect(findings[0]!.message).toContain("billing.refund");
  });
});
