/**
 * Real Taqnyat end-to-end: otp({ tier: 1 }) via Verify API + magic-link via Taqnyat Mail.
 *
 * Double-gated — runs ONLY when BOTH:
 *   1. The global per-medium opt-in flag is set explicitly
 *      (`OKE_SMS_LIVE=1` / `OKE_EMAIL_LIVE=1`), and
 *   2. the matching real credentials are present in the environment.
 *
 * Credential presence alone is NEVER enough — this mirrors sently's own
 * opt-in live suite and prevents burning provider quota on a routine
 * `bun test` run with stray credentials in the shell. The flags are
 * provider-agnostic: any future SMS or email provider live suite gates on
 * the same medium flag plus its own credentials.
 *
 * Skip is always visible (`console.log("skip: …")` + `test.skip`), never a
 * silent pass.
 *
 * Setup:
 *   # SMS OTP — sends exactly ONE real SMS (the plugin's own send; its
 *   # provider response is captured for the code-5 assertion)
 *   export OKE_SMS_LIVE=1
 *   export TAQNYAT_TOKEN=…            (or TAQNYAT_BEARER_TOKEN)
 *   export TAQNYAT_SENDER=YourBrand
 *   export OKE_TEST_TAQNYAT_PHONE=+9665xxxxxxxx   (or TAQNYAT_TO)
 *   # Mail
 *   export OKE_EMAIL_LIVE=1
 *   export TAQNYAT_MAIL_TOKEN=…
 *   export TAQNYAT_CAMPAIGN=auth
 *   export OKE_TEST_TAQNYAT_MAIL=you@example.com  (or TAQNYAT_MAIL_TO)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { magicLink } from "./magic-link.ts";
import { otp } from "./otp.ts";

const SECRET = "test-secret-at-least-16";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

function jsonPost(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const WANT_SMS = process.env.OKE_SMS_LIVE === "1";
const WANT_MAIL = process.env.OKE_EMAIL_LIVE === "1";

const SMS_TOKEN = process.env.TAQNYAT_TOKEN ?? process.env.TAQNYAT_BEARER_TOKEN;
const SMS_CREDS = Boolean(SMS_TOKEN) && Boolean(process.env.TAQNYAT_SENDER);
// OKE_TEST_TAQNYAT_PHONE wins; TAQNYAT_TO (sently's convention) is the alias.
const SMS_PHONE = process.env.OKE_TEST_TAQNYAT_PHONE ?? process.env.TAQNYAT_TO;
const LIVE_SMS = WANT_SMS && SMS_CREDS && Boolean(SMS_PHONE);

const MAIL_CREDS = Boolean(process.env.TAQNYAT_MAIL_TOKEN) && Boolean(process.env.TAQNYAT_CAMPAIGN);
const MAIL_TO = process.env.OKE_TEST_TAQNYAT_MAIL ?? process.env.TAQNYAT_MAIL_TO;
const LIVE_MAIL = WANT_MAIL && MAIL_CREDS && Boolean(MAIL_TO);

if (!LIVE_SMS) {
  console.log(
    WANT_SMS
      ? "skip: taqnyat SMS OTP live (missing TAQNYAT_TOKEN/TAQNYAT_SENDER or OKE_TEST_TAQNYAT_PHONE)"
      : "skip: taqnyat SMS OTP live (OKE_SMS_LIVE≠1)",
  );
}
if (!LIVE_MAIL) {
  console.log(
    WANT_MAIL
      ? "skip: taqnyat mail live (missing TAQNYAT_MAIL_TOKEN/TAQNYAT_CAMPAIGN or OKE_TEST_TAQNYAT_MAIL)"
      : "skip: taqnyat mail live (OKE_EMAIL_LIVE≠1)",
  );
}

const liveSms = LIVE_SMS ? test : test.skip;
const liveMail = LIVE_MAIL ? test : test.skip;

describe("taqnyat live — provider-managed OTP (Taqnyat Verify)", () => {
  liveSms(
    "phone OTP request → real sendOtp → Taqnyat success code 5",
    async () => {
      const app = oke({
        name: `taqnyat-live-${crypto.randomUUID()}`,
        env: "test",
        registry: "ignore",
        gate: { auth: { secret: SECRET } },
        config: {
          drivers: { channel: { sms: { test: "taqnyat" } } },
        },
      }).plug(otp({ tier: 1 }));
      await app.boot({ env: "test" });

      // Wrap the live transport so the plugin's single real send also proves
      // the provider accepted it (success code 5) — exactly one SMS, never two.
      const sms = app.bootResult?.channel?.drivers.find((d) => d.id === "taqnyat")?.smsTransport as
        | {
            sendOtp(o: {
              to: string;
              requestId: string;
              lang?: "en" | "ar";
            }): Promise<{ code: number }>;
          }
        | undefined;
      expect(sms).toBeDefined();
      const realSendOtp = sms!.sendOtp.bind(sms);
      let providerCode: number | undefined;
      sms!.sendOtp = async (opts) => {
        const result = await realSendOtp(opts);
        providerCode = result.code;
        return result;
      };

      const res = await app.fetch(jsonPost("/auth/otp/request", { phone: SMS_PHONE, lang: "en" }));
      const body = (await res.json()) as { data?: { ok: true }; error?: { message?: string } };
      if (res.status !== 200) {
        console.log("taqnyat sendOtp response", res.status, body);
      }
      expect(res.status).toBe(200);
      expect(body.data?.ok).toBe(true);
      // Local dev leak must stay off in the provider path.
      expect((body.data as { devOtp?: string }).devOtp).toBeUndefined();
      // Taqnyat Verify documented success code — from the plugin's own send.
      expect(providerCode).toBe(5);

      await app.stop();
    },
    30_000,
  );
});

describe("taqnyat live — magic-link via Taqnyat Mail", () => {
  liveMail(
    "magic-link request → real TaqnyatMailTransport send",
    async () => {
      const app = oke({
        name: `taqnyat-mail-live-${crypto.randomUUID()}`,
        env: "test",
        registry: "ignore",
        gate: { auth: { secret: SECRET } },
        config: {
          drivers: { channel: { email: { test: "taqnyat-mail" } } },
        },
      }).plug(magicLink({ baseUrl: "http://app.test:6530" }));
      await app.boot({ env: "test" });

      const res = await app.fetch(jsonPost("/auth/magic-link/request", { email: MAIL_TO }));
      const body = (await res.json()) as { data?: { ok: true }; error?: { message?: string } };
      if (res.status !== 200) {
        console.log("taqnyat mail send response", res.status, body);
      }
      expect(res.status).toBe(200);
      expect(body.data?.ok).toBe(true);
      expect((body.data as { devToken?: string }).devToken).toBeUndefined();

      // A successful send is recorded in the Channel receipt ledger.
      const receipts = app.bootResult?.channel?.receipts.all() ?? [];
      const sent = receipts.find((r) => r.to === MAIL_TO);
      expect(sent?.status === "sent" || sent?.status === "fallback").toBe(true);
      expect(sent?.driverId).toContain("taqnyat");

      await app.stop();
    },
    30_000,
  );
});
