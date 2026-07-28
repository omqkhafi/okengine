/**
 * WinterTC-aligned runtime primitives shared by adapters.
 * Prefer `globalThis` Web APIs; fall back to host env only where the
 * Minimum Common Web API has no answer (process env, filesystem).
 */

import type {
  PasswordAlgorithm,
  RuntimeCrypto,
  RuntimeEnv,
  RuntimeFiles,
  RuntimeTimers,
} from "./types.ts";

/** HTML / WinterTC timers on `globalThis`. */
export function createTimers(): RuntimeTimers {
  return {
    sleep(ms) {
      return new Promise((resolve) => {
        globalThis.setTimeout(resolve, ms);
      });
    },
    setTimeout(fn, ms) {
      return globalThis.setTimeout(fn, ms);
    },
    clearTimeout(id) {
      globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>);
    },
    setInterval(fn, ms) {
      return globalThis.setInterval(fn, ms);
    },
    clearInterval(id) {
      globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>);
    },
    now() {
      return globalThis.performance?.now?.() ?? Date.now();
    },
  };
}

/**
 * Environment reader — Bun.env → process.env → Deno.env.
 */
export function createEnv(): RuntimeEnv {
  return {
    get(key) {
      const bunEnv = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun
        ?.env;
      if (bunEnv && key in bunEnv) return bunEnv[key];
      const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env;
      if (proc && key in proc) return proc[key];
      const deno = (
        globalThis as {
          Deno?: { env?: { get?(k: string): string | undefined } };
        }
      ).Deno?.env;
      if (deno?.get) return deno.get(key);
      return undefined;
    },
    has(key) {
      return this.get(key) !== undefined;
    },
  };
}

/**
 * Best-effort filesystem for adapters. Prefers `Bun.file`, then `node:fs`.
 */
export function createFiles(): RuntimeFiles {
  return {
    async read(path) {
      const bun = (
        globalThis as { Bun?: { file?(p: string): { arrayBuffer(): Promise<ArrayBuffer> } } }
      ).Bun;
      if (bun?.file) {
        return new Uint8Array(await bun.file(path).arrayBuffer());
      }
      const fs = await import("node:fs/promises");
      return new Uint8Array(await fs.readFile(path));
    },
    async write(path, data) {
      const bun = (
        globalThis as {
          Bun?: {
            write?(p: string, data: Uint8Array | string): Promise<number>;
          };
        }
      ).Bun;
      if (bun?.write) {
        await bun.write(path, data);
        return;
      }
      const fs = await import("node:fs/promises");
      await fs.writeFile(path, data);
    },
    async exists(path) {
      const bun = (globalThis as { Bun?: { file?(p: string): { exists(): Promise<boolean> } } })
        .Bun;
      if (bun?.file) {
        return bun.file(path).exists();
      }
      const fs = await import("node:fs/promises");
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Web Crypto base + PBKDF2 password helpers (web-standard path).
 */
export function createWebCrypto(): RuntimeCrypto {
  const web = globalThis.crypto;
  return {
    subtle: web.subtle,
    randomUUID() {
      return web.randomUUID();
    },
    getRandomValues(array) {
      return web.getRandomValues(array);
    },
    async hashPassword(password, algorithm = "pbkdf2") {
      if (algorithm !== "pbkdf2") {
        throw new Error(
          `web-standard runtime supports only pbkdf2 passwords (got ${algorithm}); use the Bun adapter for argon2id/bcrypt`,
        );
      }
      return hashPbkdf2(password);
    },
    async verifyPassword(password, hash) {
      if (!hash.startsWith("pbkdf2$")) {
        throw new Error(
          "web-standard runtime can only verify pbkdf2$ hashes; use the Bun adapter for Bun.password hashes",
        );
      }
      return verifyPbkdf2(password, hash);
    },
  };
}

/**
 * Bun.password-backed crypto (argon2id / bcrypt) with Web Crypto for the rest.
 */
export function createBunCrypto(): RuntimeCrypto {
  const web = globalThis.crypto;
  return {
    subtle: web.subtle,
    randomUUID() {
      return web.randomUUID();
    },
    getRandomValues(array) {
      return web.getRandomValues(array);
    },
    async hashPassword(password, algorithm = "argon2id") {
      if (algorithm === "pbkdf2") return hashPbkdf2(password);
      const algo = algorithm === "bcrypt" ? "bcrypt" : "argon2id";
      return Bun.password.hash(password, algo);
    },
    async verifyPassword(password, hash) {
      if (hash.startsWith("pbkdf2$")) return verifyPbkdf2(password, hash);
      return Bun.password.verify(password, hash);
    },
  };
}

/** Encode bytes as unpadded base64url. */
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode unpadded base64url. */
function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const PBKDF2_ITERATIONS = 100_000;

async function hashPbkdf2(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

async function verifyPbkdf2(password: string, hash: string): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = Uint8Array.from(b64urlDecode(parts[2]!));
  const expected = b64urlDecode(parts[3]!);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    expected.length * 8,
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

/** Re-export algorithm type for adapters. */
export type { PasswordAlgorithm };
