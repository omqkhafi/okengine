/**
 * Vault backend status card — badges, facts, operator hint.
 */

import { describe, expect, test } from "bun:test";
import {
  formatVaultBackend,
  vaultDriverHint,
  vaultDriverKind,
  vaultDriverShortLabel,
  vaultDriverTitle,
} from "./backend.ts";
import { VAULT_BACKEND_FIXTURE } from "./fixture.ts";
import type { VaultBackend } from "./types.ts";

describe("formatVaultBackend", () => {
  test("lock-path says driver; title names built-in vs managed provider", () => {
    expect(vaultDriverShortLabel(VAULT_BACKEND_FIXTURE)).toBe("driver");
    expect(vaultDriverKind(VAULT_BACKEND_FIXTURE)).toBe("built-in");
    expect(vaultDriverTitle(VAULT_BACKEND_FIXTURE)).toBe("Built-in vault");
    expect(
      vaultDriverTitle({
        driverId: "managed",
        builtin: false,
        status: null,
        unavailable: null,
        provider: "aws-secrets-manager",
      }),
    ).toBe("AWS Secrets Manager");
    expect(
      vaultDriverKind({
        driverId: "managed",
        builtin: false,
        status: null,
        unavailable: null,
        provider: "aws-secrets-manager",
      }),
    ).toBe("managed · aws");
    expect(
      vaultDriverKind({
        driverId: "env",
        builtin: false,
        status: null,
        unavailable: null,
      }),
    ).toBe("simulate");
    expect(
      vaultDriverTitle({
        driverId: "env",
        builtin: false,
        status: null,
        unavailable: null,
      }),
    ).toBe("Simulated env");
    expect(
      vaultDriverShortLabel({
        driverId: "env",
        builtin: false,
        status: null,
        unavailable: null,
      }),
    ).toBe("driver");
    expect(vaultDriverHint(VAULT_BACKEND_FIXTURE)).toContain("Built-in vault");
    expect(
      vaultDriverHint({
        driverId: "managed",
        builtin: false,
        status: null,
        unavailable: null,
        provider: "aws-secrets-manager",
      }),
    ).toBe("Managed provider — AWS Secrets Manager");
    expect(
      vaultDriverHint({
        driverId: "env",
        builtin: false,
        status: null,
        unavailable: null,
      }),
    ).toContain("No built-in vault or managed provider");
  });

  test("null backend renders no card", () => {
    expect(formatVaultBackend(null)).toBeNull();
  });

  test("non-builtin driver shows the id with no seal badges", () => {
    const card = formatVaultBackend({
      driverId: "managed",
      builtin: false,
      status: null,
      unavailable: null,
    });
    expect(card?.title).toBe("Managed vault");
    expect(card?.badges).toEqual([]);
    expect(card?.facts).toEqual([]);
    expect(card?.hint).toBeNull();
  });

  test("sealed builtin backend warns and points at the master key", () => {
    const card = formatVaultBackend(VAULT_BACKEND_FIXTURE);
    expect(card?.badges.map((b) => b.id)).toEqual(["initialized", "sealed"]);
    expect(card?.badges.find((b) => b.id === "sealed")?.tone).toBe("warn");
    expect(card?.facts).toContainEqual({ label: "KEK generation", value: "v2" });
    expect(card?.facts).toContainEqual({ label: "Secrets stored", value: "7" });
    expect(card?.hint).toContain("OKE_VAULT_MASTER_KEY");
  });

  test("unsealed builtin backend has no hint", () => {
    const backend: VaultBackend = {
      ...VAULT_BACKEND_FIXTURE,
      status: { ...VAULT_BACKEND_FIXTURE.status!, sealed: false },
    };
    const card = formatVaultBackend(backend);
    expect(card?.badges.map((b) => b.id)).toEqual(["initialized", "unsealed"]);
    expect(card?.hint).toBeNull();
  });

  test("uninitialized backend points at `oke vault init`", () => {
    const backend: VaultBackend = {
      ...VAULT_BACKEND_FIXTURE,
      status: { ...VAULT_BACKEND_FIXTURE.status!, initialized: false },
    };
    const card = formatVaultBackend(backend);
    expect(card?.badges.map((b) => b.id)).toEqual(["uninitialized"]);
    expect(card?.hint).toContain("oke vault init");
  });

  test("an in-flight master rotation surfaces the rewrap target", () => {
    const backend: VaultBackend = {
      ...VAULT_BACKEND_FIXTURE,
      status: { ...VAULT_BACKEND_FIXTURE.status!, rewrapTargetKekVersion: 3 },
    };
    expect(formatVaultBackend(backend)?.badges.map((b) => b.label)).toContain("rewrap → kek v3");
  });

  test("unreachable builtin backend surfaces the reason", () => {
    const card = formatVaultBackend({
      driverId: "vault",
      builtin: true,
      status: null,
      unavailable: "connection refused",
    });
    expect(card?.badges.map((b) => b.id)).toEqual(["unreachable"]);
    expect(card?.hint).toBe("connection refused");
  });
});
