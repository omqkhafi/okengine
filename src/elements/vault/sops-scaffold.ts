/**
 * Scaffold age identity + `secrets.enc.json` for docker ≈ prod sops vault.
 *
 * First `oke dev --docker` generates a local identity (`.env.local`) and an
 * encrypted bag with `APP_SECRET` so apps learn the SOPS path without manual setup.
 */

import { resolve } from "node:path";
import {
  formatDotenv,
  parseDotenv,
} from "../../drivers/vault-dotenv-parse.ts";
import { buildSopsFixture } from "../../drivers/vault-sops.ts";
import {
  DEFAULT_SOPS_PATH,
  resolveAgeIdentity,
  resolveSopsPath,
} from "./chain.ts";

/** Result of {@link ensureSopsScaffold}. */
export interface SopsScaffoldResult {
  /** Whether any file was created or updated. */
  readonly created: boolean;
  /** Absolute path to the SOPS JSON bag. */
  readonly sopsPath: string;
  /** Age identity written / reused (`AGE-SECRET-KEY-…`). */
  readonly ageIdentity: string;
}

/**
 * Ensure `.env.local` holds `AGE_SECRET_KEY` and `secrets.enc.json` exists.
 *
 * Idempotent: existing identity / bag are left alone. Injects the identity into
 * `process.env` so the current process (and spawned app) can decrypt.
 *
 * @param cwd - Project root
 * @param options - Optional secret seed for a new bag
 */
export async function ensureSopsScaffold(
  cwd: string,
  options: {
    readonly secrets?: Readonly<Record<string, string>>;
  } = {},
): Promise<SopsScaffoldResult> {
  const root = resolve(cwd);
  const envLocalPath = resolve(root, ".env.local");
  const sopsPath = resolveSopsPath(root);
  let created = false;

  const envMap = new Map<string, string>();
  const envFile = Bun.file(envLocalPath);
  if (await envFile.exists()) {
    for (const [k, v] of parseDotenv(await envFile.text())) {
      envMap.set(k, v);
    }
  }

  let ageIdentity =
    resolveAgeIdentity() ??
    envMap.get("AGE_SECRET_KEY") ??
    envMap.get("OKE_AGE_IDENTITY");

  if (!ageIdentity) {
    const age = await import("age-encryption");
    ageIdentity = await age.generateIdentity();
    envMap.set("AGE_SECRET_KEY", ageIdentity);
    await Bun.write(envLocalPath, formatDotenv(envMap));
    created = true;
  } else if (!envMap.has("AGE_SECRET_KEY") && !envMap.has("OKE_AGE_IDENTITY")) {
    envMap.set("AGE_SECRET_KEY", ageIdentity);
    await Bun.write(envLocalPath, formatDotenv(envMap));
    created = true;
  }

  process.env.AGE_SECRET_KEY = ageIdentity;

  const sopsFile = Bun.file(sopsPath);
  if (!(await sopsFile.exists())) {
    const age = await import("age-encryption");
    const recipient = await age.identityToRecipient(ageIdentity);
    const secrets = {
      APP_SECRET: options.secrets?.APP_SECRET ?? "dev-only-secret",
      ...options.secrets,
    };
    const { json } = await buildSopsFixture(secrets, recipient);
    await Bun.write(sopsPath, `${json}\n`);
    created = true;
  }

  return { created, sopsPath, ageIdentity };
}

/**
 * Whether a project root already has a SOPS bag at the default path.
 *
 * @param cwd - Project root
 */
export async function hasSopsBag(cwd: string): Promise<boolean> {
  return Bun.file(resolve(cwd, DEFAULT_SOPS_PATH)).exists();
}
