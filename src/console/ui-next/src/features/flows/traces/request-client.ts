/**
 * Client facts derived from a stored HTTP frame.
 *
 * Port of the sacp user-agent classifier. Nothing is stored: the trace sheet
 * reads the headers it already has. `unknown`, `other`, and `none` stay off
 * the card.
 */

/** Device class from the user-agent and client hints. */
export type DeviceType = "unknown" | "desktop" | "mobile" | "tablet" | "bot";

/** Operating system family. */
export type Platform =
  | "windows"
  | "macos"
  | "linux"
  | "ios"
  | "ipados"
  | "android"
  | "chromeos"
  | "freebsd"
  | "openbsd"
  | "other";

/** Browser family. `none` is a non-browser client. */
export type Browser =
  | "chrome"
  | "firefox"
  | "safari"
  | "edge"
  | "arc"
  | "opera"
  | "brave"
  | "vivaldi"
  | "other"
  | "none";

/** Who sent the request. */
export type ClientType = "browser" | "api_client" | "cli" | "bot" | "other";

/** Named HTTP client when the user-agent is not a browser. */
export type ApiClient =
  | "postmanruntime"
  | "newman"
  | "insomnia"
  | "hoppscotch"
  | "curl"
  | "httpie"
  | "wget"
  | "python-requests"
  | "okhttp"
  | "axios"
  | "node-fetch"
  | "undici"
  | "other"
  | "none";

/** Facts the Request card can draw. Hidden kinds are `null`. */
export type RequestClient = {
  /** Device, or `null` when the guess is `unknown`. */
  readonly deviceType: DeviceType | null;
  /** Platform, or `null` when the guess is `other`. */
  readonly platform: Platform | null;
  /** Browser, or `null` when the guess is `other` or `none`. */
  readonly browser: Browser | null;
  /** Major, or major.minor when the minor is not zero. */
  readonly browserVersion: string | null;
  /** Client kind, or `null` when the guess is `other`. */
  readonly clientType: ClientType | null;
  /** API or CLI client, or `null` when the guess is `other` or `none`. */
  readonly apiClient: ApiClient | null;
  /** Version token for {@link apiClient}. */
  readonly apiClientVersion: string | null;
  /** Call API invoke stamped `x-oke-client: console`. */
  readonly console: boolean;
  /** Client IP from forwarding headers, when one is stored. */
  readonly ip: string | null;
  /** Raw `user-agent`, when the header is present. */
  readonly userAgent: string | null;
};

type Detection = {
  deviceType: DeviceType;
  platform: Platform;
  browser: Browser;
  clientType: ClientType;
  apiClient: ApiClient;
};

const PLATFORM_HINT: Record<string, Platform> = {
  windows: "windows",
  macos: "macos",
  "mac os": "macos",
  linux: "linux",
  android: "android",
  ios: "ios",
  ipados: "ipados",
  "chrome os": "chromeos",
  chromeos: "chromeos",
  cros: "chromeos",
  freebsd: "freebsd",
  openbsd: "openbsd",
};

/**
 * Classify the request headers already stored on a run.
 *
 * @param headers - Request header map. Names may be any case.
 */
export function requestClientFromHeaders(headers: Readonly<Record<string, string>>): RequestClient {
  const userAgent = headerValue(headers, "user-agent")?.trim() ?? "";
  const detected = detectFromUserAgent(userAgent);
  const hinted = applyClientHints(detected, userAgent.toLowerCase(), headers);
  const version = productVersion(userAgent, hinted.browser, hinted.apiClient);
  const ip = clientIp(headers);
  return {
    deviceType: hinted.deviceType === "unknown" ? null : hinted.deviceType,
    platform: hinted.platform === "other" ? null : hinted.platform,
    browser: hinted.browser === "other" || hinted.browser === "none" ? null : hinted.browser,
    browserVersion: hinted.browser === "other" || hinted.browser === "none" ? null : version,
    clientType: hinted.clientType === "other" ? null : hinted.clientType,
    apiClient:
      hinted.apiClient === "other" || hinted.apiClient === "none" ? null : hinted.apiClient,
    apiClientVersion: hinted.apiClient === "other" || hinted.apiClient === "none" ? null : version,
    console: headerValue(headers, "x-oke-client")?.trim().toLowerCase() === "console",
    ip,
    userAgent: userAgent.length > 0 ? userAgent : null,
  };
}

/**
 * Best-effort user-agent classification.
 *
 * Non-browser clients match first so Postman and curl are not read as Chrome.
 * Arc and Brave often still look like Chrome from the user-agent alone.
 *
 * @param userAgent - Raw user-agent, possibly empty
 */
export function detectFromUserAgent(userAgent?: string): Detection {
  const ua = (userAgent ?? "").trim();
  const ual = ua.toLowerCase();

  let clientType: ClientType = "other";
  let apiClient: ApiClient = "none";
  let browser: Browser = "other";
  const platform: Platform = "other";
  let deviceType: DeviceType = "unknown";

  if (/\bpostmanruntime\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "postmanruntime",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bnewman\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "cli",
      apiClient: "newman",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\binsomnia\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "insomnia",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bhoppscotch\b/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "hoppscotch",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bcurl\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "cli",
      apiClient: "curl",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bhttpie\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "cli",
      apiClient: "httpie",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bwget\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "cli",
      apiClient: "wget",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bpython-requests\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "python-requests",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bokhttp\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "okhttp",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\baxios\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "axios",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bnode-fetch\/\d+/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "node-fetch",
      browser: "none",
      platform,
      deviceType,
    });
  }
  if (/\bundici\b/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "api_client",
      apiClient: "undici",
      browser: "none",
      platform,
      deviceType,
    });
  }

  if (/\bbot\b|\bcrawler\b|\bspider\b/.test(ual)) {
    return finalize({
      ua: ual,
      clientType: "bot",
      apiClient: "none",
      browser: "none",
      platform,
      deviceType: "bot",
    });
  }

  clientType = "browser";
  apiClient = "none";
  if (/\bedg\//.test(ual)) browser = "edge";
  else if (/\barc\//.test(ual)) browser = "arc";
  else if (/\bvivaldi\//.test(ual)) browser = "vivaldi";
  else if (/\bopr\//.test(ual) || /\bopera\b/.test(ual)) browser = "opera";
  else if (/\bfirefox\//.test(ual)) browser = "firefox";
  else if (/\bchrome\//.test(ual) || /\bcrios\//.test(ual)) browser = "chrome";
  else if (/\bsafari\//.test(ual)) browser = "safari";
  else if (/\bbrave\//.test(ual)) browser = "brave";
  else browser = "other";

  return finalize({ ua: ual, clientType, apiClient, browser, platform, deviceType });
}

function finalize(input: {
  ua: string;
  clientType: ClientType;
  apiClient: ApiClient;
  browser: Browser;
  platform: Platform;
  deviceType: DeviceType;
}): Detection {
  let platform = input.platform;
  let deviceType = input.deviceType;
  const ual = input.ua;

  if (/\bwindows nt\b/.test(ual)) platform = "windows";
  else if (/\bipad\b/.test(ual)) platform = "ipados";
  else if (/\biphone\b|\bipod\b|\bcpu iphone os\b/.test(ual)) platform = "ios";
  else if (/\bandroid\b/.test(ual)) platform = "android";
  else if (/\bcros\b|\bchromeos\b/.test(ual)) platform = "chromeos";
  else if (/\bmac os x\b/.test(ual)) platform = "macos";
  else if (/\bfreebsd\b/.test(ual)) platform = "freebsd";
  else if (/\bopenbsd\b/.test(ual)) platform = "openbsd";
  else if (/\blinux\b/.test(ual)) platform = "linux";

  deviceType = deviceFromPlatform(platform, ual, deviceType);

  return {
    clientType: input.clientType,
    apiClient: input.apiClient,
    browser: input.browser,
    platform,
    deviceType,
  };
}

function deviceFromPlatform(platform: Platform, ua: string, current: DeviceType): DeviceType {
  if (current === "bot") return "bot";
  if (platform === "ipados" || /\btablet\b/.test(ua)) return "tablet";
  if (platform === "ios" || platform === "android" || /\bmobile\b/.test(ua)) return "mobile";
  if (
    platform === "windows" ||
    platform === "macos" ||
    platform === "linux" ||
    platform === "chromeos" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    return "desktop";
  }
  return current === "unknown" ? "unknown" : current;
}

function applyClientHints(
  detected: Detection,
  ua: string,
  headers: Readonly<Record<string, string>>,
): Detection {
  const platformHint = unquote(headerValue(headers, "sec-ch-ua-platform"));
  const platform = platformHint
    ? (PLATFORM_HINT[platformHint.toLowerCase()] ?? detected.platform)
    : detected.platform;
  let deviceType =
    platform === detected.platform
      ? detected.deviceType
      : deviceFromPlatform(platform, ua, detected.deviceType);
  const mobile = unquote(headerValue(headers, "sec-ch-ua-mobile"));
  if (deviceType !== "bot" && mobile === "?1") deviceType = "mobile";
  if (deviceType !== "bot" && mobile === "?0") {
    deviceType = platform === "ipados" || /\btablet\b/.test(ua) ? "tablet" : "desktop";
  }
  return { ...detected, platform, deviceType };
}

function clientIp(headers: Readonly<Record<string, string>>): string | null {
  const cf = headerValue(headers, "cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headerValue(headers, "x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = headerValue(headers, "x-real-ip")?.trim();
  return real && real.length > 0 ? real : null;
}

function productVersion(userAgent: string, browser: Browser, apiClient: ApiClient): string | null {
  const token =
    browser === "safari"
      ? matchVersion(userAgent, /version\/(\d+(?:\.\d+)*)/i)
      : browser === "edge"
        ? matchVersion(userAgent, /\bedg\/(\d+(?:\.\d+)*)/i)
        : browser === "opera"
          ? matchVersion(userAgent, /\b(?:opr|opera)\/(\d+(?:\.\d+)*)/i)
          : browser === "chrome"
            ? matchVersion(userAgent, /\b(?:chrome|crios)\/(\d+(?:\.\d+)*)/i)
            : browser !== "other" && browser !== "none"
              ? matchVersion(userAgent, new RegExp(`\\b${browser}\\/(\\d+(?:\\.\\d+)*)`, "i"))
              : apiClient !== "other" && apiClient !== "none"
                ? matchVersion(userAgent, new RegExp(`\\b${apiClient}\\/(\\d+(?:\\.\\d+)*)`, "i"))
                : null;
  return token ? displayVersion(token) : null;
}

function matchVersion(userAgent: string, pattern: RegExp): string | null {
  return pattern.exec(userAgent)?.[1] ?? null;
}

/** Major only when the minor is zero (`131.0.0.0` → `131`, `8.7.1` → `8.7`). */
function displayVersion(raw: string): string {
  const [major, minor] = raw.split(".");
  if (!major) return raw;
  if (!minor || minor === "0") return major;
  return `${major}.${minor}`;
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function unquote(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
