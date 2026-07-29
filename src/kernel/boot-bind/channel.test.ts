/**
 * Channel binder — profile selection + SMTP env parsing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { resolveEmailDriverId, smtpOptionsFromEnv } from "./channel.ts";

const previous = {
  url: process.env.SMTP_URL,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  okeUrl: process.env.OKE_CHANNEL_EMAIL_URL,
};

afterEach(() => {
  restoreEnv("SMTP_URL", previous.url);
  restoreEnv("SMTP_USER", previous.user);
  restoreEnv("SMTP_PASSWORD", previous.password);
  restoreEnv("OKE_CHANNEL_EMAIL_URL", previous.okeUrl);
});

describe("bindChannel driver resolution", () => {
  const options = {
    config: {
      drivers: {
        channel: {
          email: { local: "console", docker: "smtp", test: "console", prod: "smtp" },
        },
      },
    },
  };

  test("uses console locally and smtp in docker", () => {
    expect(resolveEmailDriverId(options, "local", false)).toBe("console");
    expect(resolveEmailDriverId(options, "docker", true)).toBe("smtp");
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
    expect(() => smtpOptionsFromEnv(true)).toThrow("docker/.env.docker");
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
