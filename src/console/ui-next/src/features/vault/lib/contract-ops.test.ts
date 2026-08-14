import { describe, expect, test } from "bun:test";
import { FIXTURE_SECRET_VALUE, VAULT_FIXTURE } from "./fixture.ts";
import {
  vaultDotenvLine,
  vaultFxSnippet,
  vaultLayerFill,
  vaultRotateCli,
  vaultSetCli,
} from "./contract-ops.ts";

describe("vault contract ops", () => {
  test("snippets never include a secret value", () => {
    const name = VAULT_FIXTURE[0]!.name;
    const blobs = [
      vaultFxSnippet(name),
      vaultSetCli(name),
      vaultRotateCli(name),
      vaultDotenvLine(name),
      vaultLayerFill("process.env", name).command,
      vaultLayerFill("driver", name).command,
    ];
    for (const blob of blobs) {
      expect(blob).not.toContain(FIXTURE_SECRET_VALUE);
      expect(blob).toContain(name);
    }
  });

  test("dotenv line is an empty assignment", () => {
    expect(vaultDotenvLine("SLACK_WEBHOOK")).toBe("SLACK_WEBHOOK=");
  });

  test("driver fill is the set CLI", () => {
    expect(vaultLayerFill("driver", "SLACK_WEBHOOK").command).toBe("oke vault set SLACK_WEBHOOK");
  });
});
