import { describe, expect, test } from "bun:test";
import {
  assertLosslessRoundTrip,
  loadManifestSchema,
  ManifestValidationError,
  manifestSchemaUrl,
  parseManifest,
  serializeManifest,
  validateManifest,
} from "./validate.ts";

const skyportUrl = new URL("./fixtures/skyport.manifest.json", import.meta.url);
const baseUrl = new URL("./fixtures/base.manifest.json", import.meta.url);

describe("validateManifest", () => {
  test("schema document loads and declares oke 1.0", async () => {
    const schema = (await loadManifestSchema()) as {
      properties: { oke: { const: string } };
    };
    expect(schema.properties.oke.const).toBe("1.0");
    expect(manifestSchemaUrl().href).toContain("manifest.v1.schema.json");
  });

  test("accepts the Skyport manifest excerpt (expanded fixture)", async () => {
    const text = await Bun.file(skyportUrl).text();
    const value = JSON.parse(text) as unknown;
    const result = await validateManifest(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.app).toBe("skyport");
      expect(result.manifest.flows?.["bookings.create"]?.errors).toEqual(["FlightFull"]);
      expect(result.manifest.tenancy?.isolation).toBe("row");
    }
  });

  test("accepts the literal Skyport excerpt from the spec (string schema placeholders)", async () => {
    const excerptUrl = new URL("./fixtures/skyport.excerpt.json", import.meta.url);
    const text = await Bun.file(excerptUrl).text();
    const result = await validateManifest(JSON.parse(text));
    expect(result.ok).toBe(true);
  });

  test("accepts the base fixture", async () => {
    const text = await Bun.file(baseUrl).text();
    const result = await validateManifest(JSON.parse(text));
    expect(result.ok).toBe(true);
  });

  test("rejects a document with the wrong oke version", async () => {
    const result = await validateManifest({ oke: "2.0", app: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.path === "/oke" || i.path === "/")).toBe(true);
    }
  });

  test("rejects a signal missing mandatory delivery", async () => {
    const result = await validateManifest({
      oke: "1.0",
      app: "x",
      signals: { ping: { retries: 1 } },
    });
    expect(result.ok).toBe(false);
  });

  test("rejects an invalid resource ref facet", async () => {
    const result = await validateManifest({
      oke: "1.0",
      app: "x",
      flows: {
        f: { effects: { reads: ["mongo:users"] } },
      },
    });
    expect(result.ok).toBe(false);
  });

  test("parseManifest throws ManifestValidationError on invalid JSON", async () => {
    expect(parseManifest("{")).rejects.toBeInstanceOf(ManifestValidationError);
  });

  test("parseManifest throws on schema-invalid documents", async () => {
    expect(parseManifest(JSON.stringify({ oke: "1.0" }))).rejects.toBeInstanceOf(
      ManifestValidationError,
    );
  });

  test("round-trip parse/serialise is lossless for Skyport", async () => {
    const text = await Bun.file(skyportUrl).text();
    const again = await assertLosslessRoundTrip(text);
    expect(again.app).toBe("skyport");
    const serialised = serializeManifest(again);
    const third = await parseManifest(serialised);
    expect(third).toEqual(again);
  });

  test("round-trip parse/serialise is lossless for base", async () => {
    const text = await Bun.file(baseUrl).text();
    await assertLosslessRoundTrip(text);
  });
});
