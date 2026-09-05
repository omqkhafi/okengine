/**
 * Shared SSE frame pump for live subscribe and JSON streams.
 *
 * @module
 */

/** Callback for one parsed SSE data frame. */
export type SseFrameHandler = (event: unknown, id: string | undefined) => void;

/**
 * Read an SSE response body until `[DONE]`, abort, or EOF.
 *
 * @param res - Fetch response (`text/event-stream`)
 * @param onEvent - Frame handler
 * @param signal - Abort signal
 * @param onOpen - Called after content-type validation
 */
export async function readSse(
  res: Response,
  onEvent: SseFrameHandler,
  signal: AbortSignal,
  onOpen?: () => void,
): Promise<void> {
  if (signal.aborted) return;
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw sseError(res.status, text);
  }
  if (!ct.includes("text/event-stream")) {
    const text = await res.text().catch(() => "");
    throw sseError(res.status, text || `Expected text/event-stream, got ${ct || "none"}`);
  }
  onOpen?.();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep = buf.indexOf("\n\n");
      while (sep >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const stop = dispatchFrame(raw, onEvent, signal);
        if (stop || signal.aborted) return;
        sep = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Yield SSE JSON frames as an async iterable until `[DONE]`.
 *
 * @param res - Fetch response
 * @param signal - Abort signal
 */
export async function* iterateSse(res: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let err: unknown;

  const pump = readSse(
    res,
    (event) => {
      queue.push(event);
      wake?.();
    },
    signal,
  )
    .then(() => {
      done = true;
      wake?.();
    })
    .catch((e) => {
      err = e;
      done = true;
      wake?.();
    });

  try {
    for (;;) {
      while (queue.length > 0) {
        yield queue.shift();
      }
      if (done) break;
      await new Promise<void>((r) => {
        wake = r;
      });
      wake = undefined;
    }
    if (err) throw err;
  } finally {
    await pump.catch(() => {});
  }
}

function dispatchFrame(raw: string, onEvent: SseFrameHandler, signal: AbortSignal): boolean {
  const dataLines: string[] = [];
  let id: string | undefined;
  for (const line of raw.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).replace(/^ /, "");
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return false;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return true;
  if (signal.aborted) return true;
  onEvent(JSON.parse(data) as unknown, id);
  return false;
}

/** Build an Error with optional HTTP status. */
export function sseError(status: number, body: string): Error {
  let message = `HTTP ${status}`;
  if (body) {
    try {
      const json: unknown = JSON.parse(body);
      if (json !== null && typeof json === "object" && "error" in json) {
        const err = (json as { error?: { code?: string; data?: { message?: string } } }).error;
        message = err?.data?.message ?? err?.code ?? message;
      }
    } catch {
      message = body.slice(0, 200);
    }
  }
  const e = new Error(message);
  (e as Error & { status?: number }).status = status;
  return e;
}
