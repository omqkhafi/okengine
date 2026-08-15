import { describe, expect, test } from "bun:test";
import { PII_MASK } from "../../elements/store/classify.ts";
import { maskPiiValue, piiFieldNamesFromManifest } from "./runs-pii.ts";
import type { Manifest } from "../../manifest/types.ts";

describe("maskPiiValue", () => {
  test("walks nested objects and arrays", () => {
    const pii = new Set(["email", "assignee_email"]);
    const masked = maskPiiValue(
      {
        id: "iss_1",
        email: "a@oke.com",
        items: [{ id: "c1", assignee_email: "b@oke.com" }],
      },
      pii,
    );
    expect(masked).toEqual({
      id: "iss_1",
      email: PII_MASK,
      items: [{ id: "c1", assignee_email: PII_MASK }],
    });
  });

  test("leaves values alone when no fields are classified", () => {
    const row = { email: "a@oke.com" };
    expect(maskPiiValue(row, new Set())).toBe(row);
  });
});

describe("piiFieldNamesFromManifest", () => {
  test("collects table column and classify-map names", () => {
    const manifest = {
      oke: "1.0",
      app: "t",
      stores: {
        db: {
          facet: "sql",
          tables: {
            members: { columns: { email: { pii: true }, name: {} } },
          },
          classifications: { "issues.assignee_email": { pii: true } },
        },
      },
    } as unknown as Manifest;
    const names = piiFieldNamesFromManifest(manifest);
    expect(names.has("email")).toBe(true);
    expect(names.has("assignee_email")).toBe(true);
    expect(names.has("assigneeEmail")).toBe(true);
    expect(names.has("name")).toBe(false);
  });

  test("aliases camelCase JS keys used by store-backed handlers", () => {
    const manifest = {
      oke: "1.0",
      app: "t",
      stores: {
        db: {
          facet: "sql",
          tables: {
            views: { columns: { ownerEmail: { pii: true } } },
          },
        },
      },
    } as unknown as Manifest;
    const names = piiFieldNamesFromManifest(manifest);
    expect(names.has("ownerEmail")).toBe(true);
    expect(names.has("owner_email")).toBe(true);
  });
});
