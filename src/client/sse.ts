/**
 * Shared SSE frame pump for live subscribe and JSON streams.
 *
 * @module
 */

/** One parsed SSE data frame. */
export interface ParsedSseFrame {
  readonly event: unknown;
  readonly id: string | undefined;
}

/**
 * Shared frame pump. `[DONE]` and abort end the iterator without throwing.
 *
 * @param res - Fetch response
 * @param signal - Abort signal
 * @param onOpen - Called after content-type validation
 */
export async function* iterateSseFrames(
  res: Response,
  signal: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<ParsedSseFrame> {
  if (signal.aborted) return;
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !ct.includes("text/event-stream")) {
    const text = await res.text().catch(() => "");
    throw sseError(res.status, text);
  }
  onOpen?.();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let sep = buf.indexOf("\n\n");
      while (sep >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const frame = parseFrame(raw);
        if (frame === "done" || signal.aborted) return;
        if (frame) yield frame;
        sep = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse one SSE block. `"done"` stops the pump; `null` skips empty blocks.
 *
 * @param raw - Text between blank lines
 */
function parseFrame(raw: string): ParsedSseFrame | "done" | null {
  const dataLines: string[] = [];
  let id: string | undefined;
  for (const line of raw.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).replace(/^ /, "");
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return "done";
  return { event: JSON.parse(data) as unknown, id };
}

/** Build an Error with optional HTTP status. */
export function sseError(status: number, body: string): Error {
  let message = `HTTP ${status}`;
  if (body) {
    try {
      const json: unknown = JSON.parse(body);
      if (json !== null && typeof json === "object" && "error" in json) {
        const err = (
          json as {
            error?: { code?: string; message?: string; data?: { message?: string } };
          }
        ).error;
        message = err?.message ?? err?.data?.message ?? err?.code ?? message;
      }
    } catch {
      message = body.slice(0, 200);
    }
  }
  const e = new Error(message);
  (e as Error & { status?: number }).status = status;
  return e;
}
