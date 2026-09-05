/**
 * Stream `docker compose up -d` so `oke dev` can show pull / start progress.
 */

/** Lifecycle phase inferred from a compose progress line. */
export type ComposeUpPhase =
  | "pulling"
  | "pulled"
  | "creating"
  | "created"
  | "starting"
  | "started"
  | "waiting"
  | "healthy"
  | "downloading"
  | "extracting"
  | "error"
  | "other";

/** One parsed compose progress event (may be activity-only). */
export type ComposeUpEvent = {
  /** Raw line with ANSI / CR noise stripped. */
  readonly raw: string;
  /** Image / service / container / network name when known. */
  readonly target?: string;
  /** Compose resource kind when the line names one. */
  readonly kind?: "container" | "image" | "network" | "volume" | "service";
  /** Lifecycle phase when known. */
  readonly phase?: ComposeUpPhase;
  /** Extra detail (download bar, error text). */
  readonly detail?: string;
};

/** Options for {@link runComposeUp}. */
export type RunComposeUpOptions = {
  readonly files: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Called for each meaningful progress line (after parse). */
  readonly onEvent?: (event: ComposeUpEvent) => void;
};

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Strip ANSI escapes and normalize whitespace for parsing / display.
 *
 * @param text - Raw chunk or line
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r/g, "");
}

/**
 * Shorten a compose container / image name for status chrome.
 *
 * @param name - Full target from compose output
 */
export function shortenComposeTarget(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  // Image refs: `postgres:16-alpine` / `library/redis:7` → repo leaf
  if (trimmed.includes(":")) {
    const repo = trimmed.slice(0, trimmed.indexOf(":"));
    const slash = repo.lastIndexOf("/");
    return slash >= 0 ? repo.slice(slash + 1) : repo;
  }
  // `oke-<slug>-postgres-1` → `postgres` (drop replica, take last segment)
  if (/^oke-/i.test(trimmed)) {
    const noReplica = trimmed.replace(/-\d+$/, "");
    const parts = noReplica.split("-").filter(Boolean);
    const leaf = parts[parts.length - 1];
    if (leaf) return leaf;
  }
  return trimmed;
}

/**
 * Human label for a compose phase (status line suffix).
 *
 * @param phase - Parsed phase
 */
export function composeUpPhaseLabel(phase: ComposeUpPhase): string {
  switch (phase) {
    case "pulling":
      return "pulling…";
    case "pulled":
      return "pulled";
    case "creating":
      return "creating…";
    case "created":
      return "created";
    case "starting":
      return "starting…";
    case "started":
      return "started";
    case "waiting":
      return "waiting…";
    case "healthy":
      return "healthy";
    case "downloading":
      return "downloading…";
    case "extracting":
      return "extracting…";
    case "error":
      return "error";
    case "other":
      return "";
  }
}

/**
 * Map a phase to a boot ● status.
 *
 * @param phase - Parsed phase
 */
export function composeUpPhaseStatus(
  phase: ComposeUpPhase,
): "ready" | "pending" | "error" {
  if (phase === "error") return "error";
  if (
    phase === "pulled" ||
    phase === "created" ||
    phase === "started" ||
    phase === "healthy"
  ) {
    return "ready";
  }
  return "pending";
}

const KIND_PHASE: Record<string, ComposeUpPhase> = {
  pulling: "pulling",
  pulled: "pulled",
  creating: "creating",
  created: "created",
  starting: "starting",
  started: "started",
  waiting: "waiting",
  healthy: "healthy",
  error: "error",
  errored: "error",
  failed: "error",
};

/**
 * Parse one docker compose progress line into a structured event.
 *
 * Handles Compose plain progress (`Image x Pulling`, `Container y Started`)
 * and common layer download chatter.
 *
 * @param line - One logical line (already split on `\n` / `\r`)
 */
export function parseComposeProgressLine(line: string): ComposeUpEvent | null {
  const raw = stripAnsi(line).trim();
  if (!raw) return null;
  // Spinner / empty chrome
  if (/^[.·…]+$/.test(raw)) return null;

  const kinded =
    /^(Container|Image|Network|Volume|Service)\s+(.+?)\s+(Pulling|Pulled|Creating|Created|Starting|Started|Waiting|Healthy|Error|Errored|Failed)\b/i.exec(
      raw,
    );
  if (kinded?.[1] && kinded[2] && kinded[3]) {
    const phase = KIND_PHASE[kinded[3].toLowerCase()] ?? "other";
    const kind = kinded[1].toLowerCase() as ComposeUpEvent["kind"];
    return { raw, target: kinded[2].trim(), kind, phase };
  }

  // `postgres Pulling` / `postgres Pulled` (service-keyed)
  const bare =
    /^([A-Za-z0-9][A-Za-z0-9._/-]*)\s+(Pulling|Pulled|Creating|Created|Starting|Started|Waiting|Healthy)\b/i.exec(
      raw,
    );
  if (bare?.[1] && bare[2]) {
    const phase = KIND_PHASE[bare[2].toLowerCase()] ?? "other";
    return { raw, target: bare[1], phase };
  }

  if (/\bDownloading\b/i.test(raw) || /\bDownload complete\b/i.test(raw)) {
    return { raw, phase: "downloading", detail: raw };
  }
  if (/\bExtracting\b/i.test(raw) || /\bPull complete\b/i.test(raw)) {
    return { raw, phase: "extracting", detail: raw };
  }
  if (/\b(error|failed|fatal)\b/i.test(raw)) {
    return { raw, phase: "error", detail: raw };
  }

  // Keep other non-empty lines as activity so pulls never look frozen.
  return { raw, phase: "other", detail: raw };
}

/**
 * Format a status message for one compose event.
 *
 * @param event - Parsed event
 */
export function formatComposeUpEventMessage(event: ComposeUpEvent): string {
  if (event.target && event.phase && event.phase !== "other") {
    const label = composeUpPhaseLabel(event.phase);
    const name = shortenComposeTarget(event.target);
    return label ? `${name} ${label}` : name;
  }
  if (event.detail) {
    // Cap long download bars for the status chrome.
    const d = event.detail.length > 72 ? `${event.detail.slice(0, 69)}…` : event.detail;
    return d;
  }
  return event.raw.length > 72 ? `${event.raw.slice(0, 69)}…` : event.raw;
}

/**
 * Pump a byte stream into logical lines (`\n` and `\r`), invoking `onLine`.
 *
 * @param stream - Process stdout/stderr
 * @param onLine - Per logical line
 * @param collect - Append raw text for error reporting
 */
async function pumpComposeStream(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
  collect: (chunk: string) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    collect(chunk);
    buf += chunk;
    // Progress bars use `\r`; treat both as line breaks.
    for (;;) {
      const nl = buf.search(/[\r\n]/);
      if (nl < 0) break;
      const line = buf.slice(0, nl);
      const sep = buf[nl];
      buf = buf.slice(nl + 1);
      // Swallow the LF of a CRLF pair.
      if (sep === "\r" && buf.startsWith("\n")) buf = buf.slice(1);
      if (line.length > 0) onLine(line);
    }
  }
  if (buf.length > 0) onLine(buf);
}

/**
 * Run `docker compose … up -d --remove-orphans --progress=plain`, streaming
 * progress events. Throws when the process exits non-zero.
 *
 * @param options - Files, cwd, env, optional event sink
 */
export async function runComposeUp(options: RunComposeUpOptions): Promise<void> {
  const args = [
    "compose",
    "--progress",
    "plain",
    ...options.files.flatMap((f) => ["-f", f]),
    "up",
    "-d",
    "--remove-orphans",
  ];
  const proc = Bun.spawn(["docker", ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...options.env,
      BUILDKIT_PROGRESS: "plain",
      COMPOSE_ANSI: "never",
    },
  });

  let stdout = "";
  let stderr = "";
  const emitLine = (line: string): void => {
    const event = parseComposeProgressLine(line);
    if (!event) return;
    options.onEvent?.(event);
  };

  await Promise.all([
    pumpComposeStream(
      proc.stdout,
      emitLine,
      (c) => {
        stdout += c;
      },
    ),
    pumpComposeStream(
      proc.stderr,
      emitLine,
      (c) => {
        stderr += c;
      },
    ),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(
      `oke dev: docker compose exited ${code}` + (detail ? `\n${detail}` : ""),
    );
  }
}
