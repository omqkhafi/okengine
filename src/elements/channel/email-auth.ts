/**
 * SPF / DKIM / DMARC verification for sending domains (console §9.9).
 *
 * DNS is injected — the element never opens a side-channel.
 */

/** Auth check result for one mechanism. */
export type AuthCheckStatus = "pass" | "fail" | "missing";

/** SPF / DKIM / DMARC verification result. */
export interface EmailAuthResult {
  readonly domain: string;
  readonly spf: AuthCheckStatus;
  readonly dkim: AuthCheckStatus;
  readonly dmarc: AuthCheckStatus;
  readonly checkedAt: number;
}

/** Injectable DNS TXT lookup. */
export type DnsTxtLookup = (name: string) => Promise<readonly string[]>;

/** Options for {@link verifyEmailAuth}. */
export interface VerifyEmailAuthOptions {
  readonly lookup: DnsTxtLookup;
  readonly dkimSelector?: string;
  readonly now?: () => number;
}

/**
 * Extract the domain from a From address / domain string.
 *
 * @param from - `noreply@example.com` or `example.com`
 */
export function domainFromFrom(from: string): string {
  const trimmed = from.trim();
  if (trimmed.includes("@")) {
    return trimmed.split("@")[1]?.toLowerCase() ?? trimmed.toLowerCase();
  }
  // Strip display-name angle brackets: Name <a@b.c>
  const angle = trimmed.match(/<([^>]+)>/);
  if (angle?.[1]?.includes("@")) {
    return angle[1].split("@")[1]!.toLowerCase();
  }
  return trimmed.toLowerCase();
}

/**
 * Verify SPF, DKIM (selector), and DMARC TXT records for a domain.
 *
 * @param domainOrFrom - Domain or From address
 * @param options - DNS lookup + optional DKIM selector
 */
export async function verifyEmailAuth(
  domainOrFrom: string,
  options: VerifyEmailAuthOptions,
): Promise<EmailAuthResult> {
  const domain = domainFromFrom(domainOrFrom);
  const selector = options.dkimSelector ?? "oke";
  const now = options.now ?? (() => Date.now());

  const [spfRecords, dkimRecords, dmarcRecords] = await Promise.all([
    safeLookup(options.lookup, domain),
    safeLookup(options.lookup, `${selector}._domainkey.${domain}`),
    safeLookup(options.lookup, `_dmarc.${domain}`),
  ]);

  return {
    domain,
    spf: classifySpf(spfRecords),
    dkim: classifyDkim(dkimRecords),
    dmarc: classifyDmarc(dmarcRecords),
    checkedAt: now(),
  };
}

async function safeLookup(
  lookup: DnsTxtLookup,
  name: string,
): Promise<readonly string[]> {
  try {
    return await lookup(name);
  } catch {
    return [];
  }
}

function classifySpf(records: readonly string[]): AuthCheckStatus {
  const joined = records.join(" ");
  if (!joined) return "missing";
  if (/v=spf1/i.test(joined)) {
    return /[-~?]all|all/i.test(joined) ? "pass" : "fail";
  }
  return "missing";
}

function classifyDkim(records: readonly string[]): AuthCheckStatus {
  const joined = records.join(" ");
  if (!joined) return "missing";
  return /v=DKIM1/i.test(joined) || /p=/i.test(joined) ? "pass" : "fail";
}

function classifyDmarc(records: readonly string[]): AuthCheckStatus {
  const joined = records.join(" ");
  if (!joined) return "missing";
  if (/v=DMARC1/i.test(joined)) {
    return /p=(none|quarantine|reject)/i.test(joined) ? "pass" : "fail";
  }
  return "missing";
}
