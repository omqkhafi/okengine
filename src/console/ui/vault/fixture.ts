/**
 * Vault panel fixture — fingerprints only; never real secret values.
 */

import type { VaultListResponse, VaultRecord } from "./types.ts";

/** Fixture secret used only for leak-detection tests (never in panel rows). */
export const FIXTURE_SECRET_VALUE = "sk_live_DO_NOT_LEAK_fixture";

/** One secret + one config for axe / unit tests. */
export const VAULT_FIXTURE: readonly VaultRecord[] = [
  {
    name: "STRIPE_KEY",
    kind: "secret",
    sensitive: true,
    description: "Payments gateway key",
    rotate: "90d",
    fingerprints: {
      dev: "sha256:aaaaaaaaaaaaaaaa",
      staging: "sha256:aaaaaaaaaaaaaaaa",
      prod: "sha256:bbbbbbbbbbbbbbbb",
    },
    fingerprint: "sha256:aaaaaaaaaaaaaaaa",
    cleartext: null,
    winner: ".env.local",
    resolution: [
      { source: "process.env", present: false, won: false },
      { source: ".env.local", present: true, won: true },
      { source: ".env.stack", present: false, won: false },
      { source: "driver", present: false, won: false },
      { source: "dev-fallback", present: false, won: false },
    ],
    readers: ["payments.charge", "payments.refund"],
    blastRadius: {
      count: 2,
      longestWakeAt: 1_800_000_000_000,
      longestOutstandingMs: 86_400_000,
      runIds: ["run_sleep_1", "run_sleep_2"],
    },
    lastReadAt: 1_700_000_000_000,
    sharedFingerprintEnvs: ["staging"],
  },
  {
    name: "PUBLIC_APP_URL",
    kind: "config",
    sensitive: false,
    description: "Public site origin",
    fingerprints: {},
    fingerprint: null,
    cleartext: "https://app.example.com",
    winner: "process.env",
    resolution: [
      { source: "process.env", present: true, won: true },
      { source: ".env.local", present: false, won: false },
      { source: ".env.stack", present: false, won: false },
      { source: "driver", present: false, won: false },
      { source: "dev-fallback", present: false, won: false },
    ],
    readers: ["site.render"],
    blastRadius: {
      count: 0,
      longestWakeAt: null,
      longestOutstandingMs: null,
      runIds: [],
    },
    lastReadAt: null,
    sharedFingerprintEnvs: [],
  },
];

/** List response matching `console.vault.list`. */
export const VAULT_LIST_FIXTURE: VaultListResponse = {
  secrets: VAULT_FIXTURE,
  env: "dev",
};
