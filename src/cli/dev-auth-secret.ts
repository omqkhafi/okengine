/**
 * One HMAC secret for `oke dev`.
 *
 * Console boots the app in the parent; the HTTP server is a child. Each
 * process would otherwise mint its own `gate.auth` secret, and a Bearer API
 * key hashed in Console would not verify on the app. This stores one
 * `OKE_AUTH_SECRET` in `.env.local` and returns it for both.
 */

import { join } from "node:path";
import { mintDevAuthSecret } from "../auth/config.ts";
import { escapeDotenvValue, parseDotenv } from "../drivers/vault-dotenv-parse.ts";

/**
 * Resolve the shared dev auth secret.
 *
 * Order: `process.env.OKE_AUTH_SECRET`, then `.env.local`, then a minted
 * value appended to `.env.local`. Does not write `process.env`.
 *
 * @param cwd - Project root
 */
export async function ensureDevAuthSecret(cwd: string): Promise<string> {
  const current = process.env.OKE_AUTH_SECRET?.trim();
  if (current) return current;

  const envPath = join(cwd, ".env.local");
  let text = "";
  const file = Bun.file(envPath);
  if (await file.exists()) {
    try {
      text = await file.text();
    } catch {
      text = "";
    }
  }
  const fromFile = parseDotenv(text).get("OKE_AUTH_SECRET")?.trim();
  if (fromFile) return fromFile;

  const secret = mintDevAuthSecret();
  const line = `OKE_AUTH_SECRET=${escapeDotenvValue(secret)}`;
  const next =
    text.length === 0
      ? `${line}\n`
      : text.endsWith("\n")
        ? `${text}${line}\n`
        : `${text}\n${line}\n`;
  await Bun.write(envPath, next);
  return secret;
}
