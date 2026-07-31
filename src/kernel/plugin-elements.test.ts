import { describe, expect, test, beforeEach } from "bun:test";
import { clock } from "../elements/clock.ts";
import { gate } from "../elements/gate.ts";
import { signal } from "../elements/signal.ts";
import { vault } from "../elements/vault.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { plugin } from "./plugin.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("plugin element contributions", () => {
  test("vault / clock / signal / gate merge into boot options", async () => {
    const otpSecret = vault.secret("OTP_SIGNING_KEY", {
      description: "2FA HMAC",
      dev: "test-otp-signing-key",
    });
    const expire = clock("expire-otp", { every: "1m" });
    const bus = signal("otp.events", { delivery: "once" });
    const member = gate.policy("plugin-member", ({ auth }) => !!auth.verified);

    const twoFactor = plugin("twoFactor-scaffold", { version: "0.0.1" })
      .vault(otpSecret)
      .clock(expire)
      .signal(bus)
      .gate(member)
      .table("otp_codes")
      .needs("store.sql");

    on(http.get("/ok").gate(gate.public), flow({ name: "ok", do: () => ({ ok: true }) }));

    const app = oke({
      name: "plugin-elements",
      gate: { policies: [gate.public] },
      vault: { allowDevFallbacks: true },
    }).plug(twoFactor);

    await app.boot({ env: "test", unguardedHttp: "allow" });
    expect(app.booted).toBe(true);
    expect(app.elements?.vault).toBeDefined();
    expect(app.elements?.clock).toBeDefined();
    expect(app.elements?.signal).toBeDefined();
    expect(app.elements?.gate).toBeDefined();
    await app.stop();
  });
});
