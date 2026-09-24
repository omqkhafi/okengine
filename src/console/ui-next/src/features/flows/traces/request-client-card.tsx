/**
 * Collapsed client strip under the request method line.
 *
 * One row of icons while closed. Expanding it lists every fact the stored
 * headers can support, including the raw user-agent.
 */

import { useMemo, useState, type JSX, type MouseEvent } from "react";
import {
  AndroidIcon,
  AppleIcon,
  ArrowDown01Icon,
  BotIcon,
  BrowserIcon,
  ChromeIcon,
  ComputerIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Globe02Icon,
  SmartPhone01Icon,
  SourceCodeIcon,
  Tablet01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  EXPLORER_CHEVRON_CLASS,
  EXPLORER_ICON_BUTTON_BARE_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  requestClientFromHeaders,
  type ApiClient,
  type Browser,
  type ClientType,
  type DeviceType,
  type Platform,
  type RequestClient,
} from "./request-client.ts";

type ClientIcon = typeof ComputerIcon;

/** Props for {@link RequestClientCard}. */
export type RequestClientCardProps = {
  /** Request headers from the stored HTTP frame. */
  readonly headers: Readonly<Record<string, string>>;
};

const DEVICE_LABEL: Record<Exclude<DeviceType, "unknown">, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
  bot: "Bot",
};

const PLATFORM_LABEL: Record<Exclude<Platform, "other">, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  ipados: "iPadOS",
  android: "Android",
  chromeos: "ChromeOS",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
};

const BROWSER_LABEL: Record<Exclude<Browser, "other" | "none">, string> = {
  chrome: "Chrome",
  firefox: "Firefox",
  safari: "Safari",
  edge: "Edge",
  arc: "Arc",
  opera: "Opera",
  brave: "Brave",
  vivaldi: "Vivaldi",
};

const CLIENT_LABEL: Record<Exclude<ClientType, "other">, string> = {
  browser: "Browser",
  api_client: "API client",
  cli: "CLI",
  bot: "Bot",
};

const API_LABEL: Record<Exclude<ApiClient, "other" | "none">, string> = {
  postmanruntime: "Postman",
  newman: "Newman",
  insomnia: "Insomnia",
  hoppscotch: "Hoppscotch",
  curl: "curl",
  httpie: "HTTPie",
  wget: "wget",
  "python-requests": "python-requests",
  okhttp: "okhttp",
  axios: "axios",
  "node-fetch": "node-fetch",
  undici: "undici",
};

type Chip = {
  readonly id: string;
  readonly icon: ClientIcon;
  readonly label: string;
};

type Fact = {
  readonly id: string;
  readonly icon: ClientIcon;
  readonly label: string;
  readonly value: string;
};

/**
 * Icon strip for the client that sent this request.
 *
 * Renders nothing when the headers cannot name a device, client, or address.
 *
 * @param props - Stored request headers
 */
export function RequestClientCard({ headers }: RequestClientCardProps): JSX.Element | null {
  const client = useMemo(() => requestClientFromHeaders(headers), [headers]);
  const chips = clientChips(client);
  const facts = clientFacts(client);
  const [open, setOpen] = useState(false);
  if (chips.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="trace-request-client">
      <div className={cn(EXPLORER_STRIP_CLASS, "border-t")}>
        <CollapsibleTrigger
          className={cn(EXPLORER_STRIP_TOKEN_CLASS, "min-w-0 flex-1 justify-start gap-3")}
          data-slot="trace-request-client-toggle"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(EXPLORER_CHEVRON_CLASS, !open && "-rotate-90")}
          />
          <span className="flex min-w-0 items-center gap-3 overflow-hidden">
            {chips.map((chip) => (
              <span key={chip.id} className="inline-flex min-w-0 items-center gap-1">
                <HugeiconsIcon icon={chip.icon} className={EXPLORER_ICON_CLASS} />
                <span className="truncate">{chip.label}</span>
              </span>
            ))}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul data-slot="trace-request-client-facts">
          {facts.map((fact) => (
            <li key={fact.id} className={cn(EXPLORER_ROW_CLASS, "group/fact")}>
              <HugeiconsIcon icon={fact.icon} className={EXPLORER_ICON_CLASS} />
              <span className="w-[5.5rem] shrink-0 text-[11px] text-muted-foreground">
                {fact.label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground select-all">
                {fact.value}
              </span>
              {fact.id === "user-agent" ? <CopyFact text={fact.value} /> : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function clientChips(client: RequestClient): Chip[] {
  const chips: Chip[] = [];
  if (client.deviceType && client.deviceType !== "unknown") {
    chips.push({
      id: "device",
      icon: deviceIcon(client.deviceType),
      label: DEVICE_LABEL[client.deviceType],
    });
  }
  if (client.platform && client.platform !== "other") {
    chips.push({
      id: "platform",
      icon: platformIcon(client.platform),
      label: PLATFORM_LABEL[client.platform],
    });
  }
  const identity = identityChip(client);
  if (identity) chips.push(identity);
  return chips;
}

function identityChip(client: RequestClient): Chip | null {
  if (client.browser && client.browser !== "none" && client.browser !== "other") {
    return {
      id: "browser",
      icon: client.browser === "chrome" ? ChromeIcon : BrowserIcon,
      label: withVersion(BROWSER_LABEL[client.browser], client.browserVersion),
    };
  }
  if (client.apiClient && client.apiClient !== "none" && client.apiClient !== "other") {
    return {
      id: "api",
      icon: SourceCodeIcon,
      label: withVersion(API_LABEL[client.apiClient], client.apiClientVersion),
    };
  }
  if (client.console) return { id: "console", icon: ComputerTerminal01Icon, label: "Console" };
  if (client.clientType && client.clientType !== "other") {
    return {
      id: "client",
      icon: clientIcon(client.clientType),
      label: CLIENT_LABEL[client.clientType],
    };
  }
  if (client.ip) return { id: "network", icon: Globe02Icon, label: client.ip };
  return null;
}

function clientFacts(client: RequestClient): Fact[] {
  const facts: Fact[] = [];
  if (client.deviceType && client.deviceType !== "unknown") {
    facts.push({
      id: "device",
      icon: deviceIcon(client.deviceType),
      label: "Device",
      value: DEVICE_LABEL[client.deviceType],
    });
  }
  if (client.platform && client.platform !== "other") {
    facts.push({
      id: "platform",
      icon: platformIcon(client.platform),
      label: "Platform",
      value: PLATFORM_LABEL[client.platform],
    });
  }
  if (client.browser && client.browser !== "none" && client.browser !== "other") {
    facts.push({
      id: "browser",
      icon: client.browser === "chrome" ? ChromeIcon : BrowserIcon,
      label: "Browser",
      value: withVersion(BROWSER_LABEL[client.browser], client.browserVersion),
    });
  }
  if (client.console) {
    facts.push({ id: "client", icon: ComputerTerminal01Icon, label: "Client", value: "Console" });
  } else if (
    client.clientType &&
    client.clientType !== "browser" &&
    client.clientType !== "other"
  ) {
    facts.push({
      id: "client",
      icon: clientIcon(client.clientType),
      label: "Client",
      value: CLIENT_LABEL[client.clientType],
    });
  }
  if (client.apiClient && client.apiClient !== "none" && client.apiClient !== "other") {
    facts.push({
      id: "api",
      icon: SourceCodeIcon,
      label: "API client",
      value: withVersion(API_LABEL[client.apiClient], client.apiClientVersion),
    });
  }
  if (client.ip) {
    facts.push({ id: "network", icon: Globe02Icon, label: "Network", value: client.ip });
  }
  if (client.userAgent) {
    facts.push({
      id: "user-agent",
      icon: SourceCodeIcon,
      label: "User agent",
      value: client.userAgent,
    });
  }
  return facts;
}

function CopyFact({ text }: { readonly text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      className={cn(EXPLORER_ICON_BUTTON_BARE_CLASS, "opacity-0 group-hover/fact:opacity-100")}
      aria-label={copied ? "Copied" : "Copy user agent"}
      data-slot="trace-request-client-copy-ua"
      onClick={(event) => void onCopy(event)}
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-3.5" />
    </button>
  );
}

function withVersion(name: string, version: string | null): string {
  return version ? `${name} ${version}` : name;
}

function deviceIcon(device: Exclude<DeviceType, "unknown">): ClientIcon {
  switch (device) {
    case "mobile":
      return SmartPhone01Icon;
    case "tablet":
      return Tablet01Icon;
    case "bot":
      return BotIcon;
    default:
      return ComputerIcon;
  }
}

function platformIcon(platform: Exclude<Platform, "other">): ClientIcon {
  switch (platform) {
    case "macos":
    case "ios":
    case "ipados":
      return AppleIcon;
    case "android":
      return AndroidIcon;
    case "chromeos":
      return ChromeIcon;
    case "linux":
    case "freebsd":
    case "openbsd":
      return ComputerTerminal01Icon;
    default:
      return ComputerIcon;
  }
}

function clientIcon(clientType: Exclude<ClientType, "other">): ClientIcon {
  switch (clientType) {
    case "cli":
    case "api_client":
      return SourceCodeIcon;
    case "bot":
      return BotIcon;
    default:
      return BrowserIcon;
  }
}
