import { describe, expect, test } from "bun:test";
import {
  assertExportHasNoSecrets,
  exportSafeList,
  exportSafeRow,
} from "./export-safe.ts";
import { FIXTURE_SECRET_VALUE, VAULT_FIXTURE } from "./fixture.ts";

describe("exportSafe", () => {
  test("never includes secret cleartext; config cleartext is allowed", () => {
    const secret = VAULT_FIXTURE[0]!;
    const config = VAULT_FIXTURE[1]!;
    const leaked = {
      ...secret,
      // Simulate a buggy row that somehow held cleartext — export must scrub.
      cleartext: FIXTURE_SECRET_VALUE,
    };
    const safe = exportSafeRow(leaked);
    expect(safe.cleartext).toBeNull();
    expect(JSON.stringify(safe)).not.toContain(FIXTURE_SECRET_VALUE);

    const configSafe = exportSafeRow(config);
    expect(configSafe.cleartext).toBe("https://app.example.com");

    const list = exportSafeList(VAULT_FIXTURE);
    assertExportHasNoSecrets(list, [FIXTURE_SECRET_VALUE]);
    expect(list).toContain("sha256:aaaaaaaaaaaaaaaa");
    expect(list).toContain("https://app.example.com");
  });
});
