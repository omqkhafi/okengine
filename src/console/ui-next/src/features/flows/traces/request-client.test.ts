/**
 * User-agent classification for the trace Request card.
 */

import { describe, expect, test } from "bun:test";
import { detectFromUserAgent, requestClientFromHeaders } from "./request-client.ts";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("detectFromUserAgent", () => {
  test("reads Chrome on macOS as a desktop browser", () => {
    expect(detectFromUserAgent(CHROME_MAC)).toEqual({
      deviceType: "desktop",
      platform: "macos",
      browser: "chrome",
      clientType: "browser",
      apiClient: "none",
    });
  });

  test("classifies curl before Chrome and still reads the platform", () => {
    expect(detectFromUserAgent("curl/8.7.1 (Macintosh; Mac OS X)")).toMatchObject({
      apiClient: "curl",
      clientType: "cli",
      browser: "none",
      platform: "macos",
      deviceType: "desktop",
    });
  });

  test("prefers Edge over the Chrome token", () => {
    expect(
      detectFromUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      ).browser,
    ).toBe("edge");
  });

  test("treats iPad as a tablet and iPhone as a phone", () => {
    expect(detectFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toMatchObject({
      platform: "ipados",
      deviceType: "tablet",
    });
    expect(
      detectFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    ).toMatchObject({
      platform: "ios",
      deviceType: "mobile",
    });
  });

  test("marks crawlers as bots", () => {
    expect(
      detectFromUserAgent(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ),
    ).toMatchObject({
      clientType: "bot",
      deviceType: "bot",
      browser: "none",
    });
  });
});

describe("requestClientFromHeaders", () => {
  test("hides empty guesses and keeps a short version", () => {
    const client = requestClientFromHeaders({ "user-agent": CHROME_MAC });
    expect(client.browser).toBe("chrome");
    expect(client.browserVersion).toBe("131");
    expect(client.platform).toBe("macos");
    expect(client.deviceType).toBe("desktop");
    expect(client.apiClient).toBeNull();
    expect(client.ip).toBeNull();
    expect(client.console).toBe(false);
  });

  test("lets client hints override the user-agent", () => {
    const client = requestClientFromHeaders({
      "user-agent": CHROME_MAC,
      "sec-ch-ua-platform": '"Android"',
      "sec-ch-ua-mobile": "?1",
    });
    expect(client.platform).toBe("android");
    expect(client.deviceType).toBe("mobile");
  });

  test("reads the client IP in Cloudflare, forwarded, then real order", () => {
    expect(
      requestClientFromHeaders({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "9.9.9.9" }).ip,
    ).toBe("1.1.1.1");
    expect(requestClientFromHeaders({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }).ip).toBe("2.2.2.2");
    expect(requestClientFromHeaders({ "x-real-ip": "4.4.4.4" }).ip).toBe("4.4.4.4");
  });

  test("labels a Call API invoke as Console and skips the browser", () => {
    const client = requestClientFromHeaders({
      accept: "application/json",
      "x-oke-client": "console",
    });
    expect(client.console).toBe(true);
    expect(client.browser).toBeNull();
    expect(client.apiClient).toBeNull();
    expect(client.userAgent).toBeNull();
    expect(client.deviceType).toBeNull();
  });

  test("keeps curl's minor version", () => {
    const client = requestClientFromHeaders({ "user-agent": "curl/8.7.1" });
    expect(client.apiClient).toBe("curl");
    expect(client.apiClientVersion).toBe("8.7");
    expect(client.browser).toBeNull();
  });
});
