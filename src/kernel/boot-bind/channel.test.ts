/**
 * Channel binder — profile selection + env parsing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  msegatOptionsFromEnv,
  resendOptionsFromEnv,
  resolveEmailDriverId,
  resolveSmsDriverId,
  smtpOptionsFromEnv,
  sndrOptionsFromEnv,
  taqnyatMailOptionsFromEnv,
  taqnyatOptionsFromEnv,
  unifonicOptionsFromEnv,
} from "./channel.ts";

const previous = {
  url: process.env.SMTP_URL,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  okeUrl: process.env.OKE_CHANNEL_EMAIL_URL,
  resend: process.env.RESEND_API_KEY,
  sndr: process.env.SNDR_API_KEY,
  sndrBase: process.env.SNDR_BASE_URL,
  taqBearer: process.env.TAQNYAT_BEARER_TOKEN,
  taqSender: process.env.TAQNYAT_SENDER,
  taqMailToken: process.env.TAQNYAT_MAIL_TOKEN,
  taqCampaign: process.env.TAQNYAT_CAMPAIGN,
  msegatUser: process.env.MSEGAT_USERNAME,
  msegatKey: process.env.MSEGAT_API_KEY,
  msegatSender: process.env.MSEGAT_SENDER,
  unifonicSid: process.env.UNIFONIC_APPSID,
  unifonicSender: process.env.UNIFONIC_SENDER,
};

afterEach(() => {
  restoreEnv("SMTP_URL", previous.url);
  restoreEnv("SMTP_USER", previous.user);
  restoreEnv("SMTP_PASSWORD", previous.password);
  restoreEnv("OKE_CHANNEL_EMAIL_URL", previous.okeUrl);
  restoreEnv("RESEND_API_KEY", previous.resend);
  restoreEnv("SNDR_API_KEY", previous.sndr);
  restoreEnv("SNDR_BASE_URL", previous.sndrBase);
  restoreEnv("TAQNYAT_BEARER_TOKEN", previous.taqBearer);
  restoreEnv("TAQNYAT_SENDER", previous.taqSender);
  restoreEnv("TAQNYAT_MAIL_TOKEN", previous.taqMailToken);
  restoreEnv("TAQNYAT_CAMPAIGN", previous.taqCampaign);
  restoreEnv("MSEGAT_USERNAME", previous.msegatUser);
  restoreEnv("MSEGAT_API_KEY", previous.msegatKey);
  restoreEnv("MSEGAT_SENDER", previous.msegatSender);
  restoreEnv("UNIFONIC_APPSID", previous.unifonicSid);
  restoreEnv("UNIFONIC_SENDER", previous.unifonicSender);
});

describe("bindChannel driver resolution", () => {
  const options = {
    config: {
      drivers: {
        channel: {
          email: { dev: "smtp", test: "console", prod: "sndr" },
          sms: { dev: "taqnyat", test: "msegat", prod: "taqnyat" },
        },
      },
    },
  };

  test("uses console locally and smtp in docker", () => {
    expect(resolveEmailDriverId(options, "test", false)).toBe("console");
    expect(resolveEmailDriverId(options, "dev", true)).toBe("smtp");
    expect(resolveEmailDriverId(options, "prod", false)).toBe("sndr");
  });

  test("resolves sms driver ids", () => {
    expect(resolveSmsDriverId(options, "test")).toBe("msegat");
    expect(resolveSmsDriverId(options, "dev")).toBe("taqnyat");
    expect(resolveSmsDriverId(options, "prod")).toBe("taqnyat");
  });

  test("parses SMTP_URL and optional auth overrides", () => {
    process.env.SMTP_URL = "smtp://url-user:url-pass@127.0.0.1:20975";
    process.env.SMTP_USER = "override-user";
    process.env.SMTP_PASSWORD = "override-pass";
    expect(smtpOptionsFromEnv(true)).toEqual({
      host: "127.0.0.1",
      port: 20975,
      user: "override-user",
      pass: "override-pass",
    });
  });

  test("missing SMTP_URL includes docker recovery hint", () => {
    delete process.env.SMTP_URL;
    delete process.env.OKE_CHANNEL_EMAIL_URL;
    expect(() => smtpOptionsFromEnv(true)).toThrow(".env.local");
  });

  test("resend and sndr env helpers", () => {
    process.env.RESEND_API_KEY = "re_x";
    expect(resendOptionsFromEnv()).toEqual({ apiKey: "re_x" });
    process.env.SNDR_API_KEY = "sndr_test_x";
    process.env.SNDR_BASE_URL = "https://api.example.test";
    expect(sndrOptionsFromEnv()).toEqual({
      apiKey: "sndr_test_x",
      url: "https://api.example.test",
    });
  });

  test("taqnyat, msegat, and unifonic env helpers", () => {
    process.env.TAQNYAT_BEARER_TOKEN = "bearer";
    process.env.TAQNYAT_SENDER = "Brand";
    expect(taqnyatOptionsFromEnv()).toEqual({ bearerToken: "bearer", sender: "Brand" });
    process.env.MSEGAT_USERNAME = "user";
    process.env.MSEGAT_API_KEY = "key";
    process.env.MSEGAT_SENDER = "Brand";
    expect(msegatOptionsFromEnv()).toEqual({
      userName: "user",
      apiKey: "key",
      sender: "Brand",
    });
    process.env.UNIFONIC_APPSID = "sid";
    process.env.UNIFONIC_SENDER = "Brand";
    expect(unifonicOptionsFromEnv()).toEqual({ appSid: "sid", sender: "Brand" });
  });

  test("taqnyat-mail env helper", () => {
    process.env.TAQNYAT_MAIL_TOKEN = "bearer-mail";
    process.env.TAQNYAT_CAMPAIGN = "auth";
    expect(taqnyatMailOptionsFromEnv()).toEqual({
      bearerToken: "bearer-mail",
      campaignName: "auth",
    });
    delete process.env.TAQNYAT_CAMPAIGN;
    expect(() => taqnyatMailOptionsFromEnv()).toThrow("TAQNYAT_CAMPAIGN");
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
