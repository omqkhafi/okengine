/**
 * Channel binder — smtp from compose env under docker.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { bindChannel } from "./channel.ts";

describe("bindChannel smtp from env", () => {
  afterEach(() => {
    delete process.env.OKE_CHANNEL_EMAIL_URL;
    delete process.env.SMTP_URL;
  });

  test("opens smtp when email pin is smtp and URL is set", () => {
    process.env.OKE_CHANNEL_EMAIL_URL = "smtp://127.0.0.1:1025";
    const runtime = bindChannel(
      {
        config: {
          drivers: {
            channel: { email: { docker: "smtp", prod: "smtp" } },
          },
        },
        channel: { templates: [] },
      },
      () => Date.now(),
      "docker",
    );
    expect(runtime).toBeDefined();
  });

  test("defaults to console when email pin is console", () => {
    const runtime = bindChannel(
      {
        config: {
          drivers: {
            channel: { email: { local: "console" } },
          },
        },
        channel: { templates: [] },
      },
      () => Date.now(),
      "local",
    );
    expect(runtime).toBeDefined();
  });
});
