/**
 * Real Mailpit end-to-end: magic-link / email-otp request → SMTP → Mailpit API.
 *
 * Opt-in via `OKE_TEST_DOCKER=1` plus a live Docker daemon — same real-skip
 * pattern as pgvector / Meilisearch (`const live = … ? test : test.skip`).
 * Never an empty pass.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveInfrastructure, writeDerivedFiles } from "../docker/index.ts";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { otp } from "./otp.ts";
import { magicLink } from "./magic-link.ts";

const SECRET = "test-secret-at-least-16";
const MAILPIT_IMAGE = "axllent/mailpit:v1.30.7";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

function dockerAvailable(): boolean {
  try {
    const proc = Bun.spawnSync(["docker", "info"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

const WANT = process.env.OKE_TEST_DOCKER === "1";
const DOCKER = WANT && dockerAvailable();
if (!DOCKER) {
  console.log(
    WANT
      ? "skip: mailpit e2e (docker daemon not available)"
      : "skip: mailpit e2e (OKE_TEST_DOCKER≠1)",
  );
}
const live = DOCKER ? test : test.skip;

interface MailpitMessageSummary {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
  readonly Snippet?: string;
}

interface MailpitMessage {
  readonly ID: string;
  readonly Subject: string;
  readonly Text?: string;
  readonly HTML?: string;
  readonly To: readonly { readonly Address: string }[];
}

interface MailpitList {
  readonly total: number;
  readonly messages: readonly MailpitMessageSummary[];
}

async function waitForMailpit(uiUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${uiUrl}/api/v1/info`);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await Bun.sleep(250);
  }
  throw new Error(`mailpit not ready at ${uiUrl}`);
}

async function clearMailpit(uiUrl: string): Promise<void> {
  await fetch(`${uiUrl}/api/v1/messages`, { method: "DELETE" });
}

async function waitForMessage(
  uiUrl: string,
  to: string,
  timeoutMs = 15_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${uiUrl}/api/v1/messages`);
    expect(listRes.ok).toBe(true);
    const list = (await listRes.json()) as MailpitList;
    const hit = list.messages.find((m) => m.To.some((addr) => addr.Address === to));
    if (hit) {
      const msgRes = await fetch(`${uiUrl}/api/v1/message/${hit.ID}`);
      expect(msgRes.ok).toBe(true);
      return (await msgRes.json()) as MailpitMessage;
    }
    await Bun.sleep(200);
  }
  throw new Error(`no Mailpit message for ${to} within ${timeoutMs}ms`);
}

function jsonPost(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth delivery — Mailpit integration", () => {
  live(
    "magic-link request lands a real email containing the token and link",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oke-mailpit-ml-"));
      const dockerDir = join(dir, "docker");
      const project = `oke-mp-ml-${Date.now()}`;
      const prevSmtp = process.env.SMTP_URL;
      const prevOkeSmtp = process.env.OKE_CHANNEL_EMAIL_URL;

      try {
        // Offset host ports so a developer's already-running Mailpit on
        // :1025/:8025 does not collide with the test stack.
        const instanceId = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
        const derived = deriveInfrastructure({
          images: { "channel.email": MAILPIT_IMAGE },
          app: "mailpit-ml",
          host: "127.0.0.1",
          includeApp: false,
          composeDir: "docker",
          instanceId,
        });
        await writeDerivedFiles(derived, dockerDir, { writeStackEnv: true });

        const composeFiles = ["compose.yml", "compose.channel.email.yml"];
        const up = Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            ...composeFiles.flatMap((f) => ["-f", f]),
            "up",
            "-d",
          ],
          {
            cwd: dockerDir,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, ...derived.stackEnv },
          },
        );
        const [upErr, upCode] = await Promise.all([new Response(up.stderr).text(), up.exited]);
        expect(upCode).toBe(0);
        if (upCode !== 0) console.error(upErr);

        const uiUrl = derived.stackEnv.MAILPIT_UI_URL!;
        const smtpUrl = derived.stackEnv.SMTP_URL!;
        await waitForMailpit(uiUrl);
        await clearMailpit(uiUrl);

        process.env.SMTP_URL = smtpUrl;
        process.env.OKE_CHANNEL_EMAIL_URL = smtpUrl;

        const email = `ml-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const baseUrl = "http://app.test:6530";
        const app = oke({
          name: `mailpit-ml-${crypto.randomUUID()}`,
          env: "test",
          registry: "ignore",
          gate: { auth: { secret: SECRET } },
          config: {
            drivers: { channel: { email: { test: "smtp" } } },
          },
        }).plug(
          magicLink({
            exposeDevToken: true,
            baseUrl,
          }),
        );
        await app.boot({ env: "test" });

        const res = await app.fetch(jsonPost("/auth/magic-link/request", { email }));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { ok: true; devToken?: string } };
        expect(body.data.ok).toBe(true);
        expect(body.data.devToken).toBeTruthy();
        const token = body.data.devToken!;
        const expectedLink = `${baseUrl}/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

        const msg = await waitForMessage(uiUrl, email);
        expect(msg.Subject).toBe("Your sign-in link");
        const text = msg.Text ?? "";
        const html = msg.HTML ?? "";
        expect(text.includes(token) || html.includes(token)).toBe(true);
        expect(text.includes(expectedLink) || html.includes(expectedLink)).toBe(true);

        await app.stop();
      } finally {
        if (prevSmtp === undefined) delete process.env.SMTP_URL;
        else process.env.SMTP_URL = prevSmtp;
        if (prevOkeSmtp === undefined) delete process.env.OKE_CHANNEL_EMAIL_URL;
        else process.env.OKE_CHANNEL_EMAIL_URL = prevOkeSmtp;

        await Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            "-f",
            "compose.yml",
            "-f",
            "compose.channel.email.yml",
            "down",
            "-v",
          ],
          { cwd: dockerDir, stdout: "pipe", stderr: "pipe" },
        ).exited.catch(() => {});
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    120_000,
  );

  live(
    "email-otp request lands a real email containing the OTP",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oke-mailpit-otp-"));
      const dockerDir = join(dir, "docker");
      const project = `oke-mp-otp-${Date.now()}`;
      const prevSmtp = process.env.SMTP_URL;
      const prevOkeSmtp = process.env.OKE_CHANNEL_EMAIL_URL;

      try {
        const instanceId = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
        const derived = deriveInfrastructure({
          images: { "channel.email": MAILPIT_IMAGE },
          app: "mailpit-otp",
          host: "127.0.0.1",
          includeApp: false,
          composeDir: "docker",
          instanceId,
        });
        await writeDerivedFiles(derived, dockerDir, { writeStackEnv: true });

        const composeFiles = ["compose.yml", "compose.channel.email.yml"];
        const up = Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            ...composeFiles.flatMap((f) => ["-f", f]),
            "up",
            "-d",
          ],
          {
            cwd: dockerDir,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, ...derived.stackEnv },
          },
        );
        const [upErr, upCode] = await Promise.all([new Response(up.stderr).text(), up.exited]);
        expect(upCode).toBe(0);
        if (upCode !== 0) console.error(upErr);

        const uiUrl = derived.stackEnv.MAILPIT_UI_URL!;
        const smtpUrl = derived.stackEnv.SMTP_URL!;
        await waitForMailpit(uiUrl);
        await clearMailpit(uiUrl);

        process.env.SMTP_URL = smtpUrl;
        process.env.OKE_CHANNEL_EMAIL_URL = smtpUrl;

        const email = `otp-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const app = oke({
          name: `mailpit-otp-${crypto.randomUUID()}`,
          env: "test",
          registry: "ignore",
          gate: { auth: { secret: SECRET } },
          config: {
            drivers: { channel: { email: { test: "smtp" } } },
          },
        }).plug(otp({ mode: "app", channels: ["email"], exposeDevOtp: true }));
        await app.boot({ env: "test" });

        const res = await app.fetch(jsonPost("/auth/otp/request", { email }));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { ok: true; devOtp?: string } };
        expect(body.data.ok).toBe(true);
        expect(body.data.devOtp).toMatch(/^\d{6}$/);
        const code = body.data.devOtp!;

        const msg = await waitForMessage(uiUrl, email);
        expect(msg.Subject).toBe("Your sign-in code");
        const text = msg.Text ?? "";
        const html = msg.HTML ?? "";
        expect(text.includes(code) || html.includes(code)).toBe(true);

        await app.stop();
      } finally {
        if (prevSmtp === undefined) delete process.env.SMTP_URL;
        else process.env.SMTP_URL = prevSmtp;
        if (prevOkeSmtp === undefined) delete process.env.OKE_CHANNEL_EMAIL_URL;
        else process.env.OKE_CHANNEL_EMAIL_URL = prevOkeSmtp;

        await Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            "-f",
            "compose.yml",
            "-f",
            "compose.channel.email.yml",
            "down",
            "-v",
          ],
          { cwd: dockerDir, stdout: "pipe", stderr: "pipe" },
        ).exited.catch(() => {});
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    120_000,
  );
});
