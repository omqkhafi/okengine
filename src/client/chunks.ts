/**
 * Lazy loaders for the live subscribe and finite-stream chunks.
 *
 * The `import()` calls are the split points. Route tables stay eager.
 *
 * @module
 */

type LiveModule = typeof import("./live.ts");
type StreamModule = typeof import("./stream.ts");

let liveLoader: () => Promise<LiveModule> = () => import("./live.ts");
let streamLoader: () => Promise<StreamModule> = () => import("./stream.ts");
let livePromise: Promise<LiveModule> | undefined;
let streamPromise: Promise<StreamModule> | undefined;

/**
 * Load `subscribeLive` (and the shared SSE pump) once.
 */
export function loadLiveModule(): Promise<LiveModule> {
  return (livePromise ??= liveLoader());
}

/**
 * Load `openStream` once.
 */
export function loadStreamModule(): Promise<StreamModule> {
  return (streamPromise ??= streamLoader());
}

/**
 * Replace the live chunk loader. `null` restores `import("./live.ts")`
 * and drops the cached promise so the next subscribe waits again.
 *
 * @param loader - Deferred loader, or `null` to restore the real chunk
 * @internal
 */
export function __setLiveChunkLoaderForTests(loader: (() => Promise<LiveModule>) | null): void {
  livePromise = undefined;
  liveLoader = loader ?? (() => import("./live.ts"));
}

/**
 * Replace the stream chunk loader. `null` restores `import("./stream.ts")`.
 *
 * @param loader - Deferred loader, or `null` to restore the real chunk
 * @internal
 */
export function __setStreamChunkLoaderForTests(loader: (() => Promise<StreamModule>) | null): void {
  streamPromise = undefined;
  streamLoader = loader ?? (() => import("./stream.ts"));
}
