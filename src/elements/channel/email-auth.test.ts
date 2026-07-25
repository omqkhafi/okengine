/**
 * SPF / DKIM / DMARC verification with injectable DNS.
 */

import { describe, expect, test } from "bun:test";
import { domainFromFrom, verifyEmailAuth } from "./email-auth.ts";

describe("verifyEmailAuth", () => {
  test("extracts domain from From address", () => {
    expect(domainFromFrom("noreply@skyport.dev")).toBe("skyport.dev");
  });

  test("classifies SPF DKIM DMARC from TXT records", async () => {
    const result = await verifyEmailAuth("skyport.dev", {
      dkimSelector: "oke",
      now: () => 1,
      async lookup(name) {
        if (name === "skyport.dev") return ["v=spf1 include:_spf.google.com ~all"];
        if (name === "oke._domainkey.skyport.dev") {
          return ["v=DKIM1; k=rsa; p=MIIB"];
        }
        if (name === "_dmarc.skyport.dev") {
          return ["v=DMARC1; p=quarantine; rua=mailto:d@skyport.dev"];
        }
        return [];
      },
    });
    expect(result).toEqual({
      domain: "skyport.dev",
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
      checkedAt: 1,
    });
  });

  test("missing records are missing, not fail", async () => {
    const result = await verifyEmailAuth("empty.test", {
      async lookup() {
        return [];
      },
    });
    expect(result.spf).toBe("missing");
    expect(result.dkim).toBe("missing");
    expect(result.dmarc).toBe("missing");
  });
});
