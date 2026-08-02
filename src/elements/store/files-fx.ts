/**
 * Capability-gated files handle for `fx.store` — keeps Bun.Image pipeline
 * code in the store element so the kernel edge profile stays lean.
 */

import type { StoreDecl } from "./declare.ts";
import {
  createFilesImagePipeline,
  putImageToBucket,
  type FilesImageOptions,
  type PutImageOptions,
} from "./files-image.ts";
import type { FilesStoreFxHandle } from "./runtime.ts";

/** Gate + dry-run hooks supplied by `createFxContext`. */
export interface GatedFilesFxBridge {
  /**
   * Capability-check + ledger one effect, then run `body`.
   *
   * @param kind - Effect kind
   * @param resource - Resource ref
   * @param body - Work to run under the gate
   */
  gate<T>(kind: "read" | "write", resource: string, body: () => Promise<T>): Promise<T>;
  /** Throw when a driver-backed write cannot be isolated in dry-run. */
  refuseDryRunWrite(): void;
}

/**
 * Lazy, capability-gated files handle — `image()` stays sync for chaining;
 * terminals and CRUD record read/write effects.
 *
 * @param decl - Files store declaration
 * @param open - Opens (and caches) the runtime handle
 * @param bridge - fx gate + dry-run hooks
 */
export function createGatedFilesStoreHandle(
  decl: StoreDecl,
  open: () => Promise<FilesStoreFxHandle>,
  bridge: GatedFilesFxBridge,
): FilesStoreFxHandle {
  const ref = decl.ref as `files:${string}`;
  let cached: FilesStoreFxHandle | undefined;
  const ensure = async (): Promise<FilesStoreFxHandle> => {
    if (!cached) cached = await open();
    return cached;
  };
  const access = {
    get: (key: string) =>
      bridge.gate("read", ref, async () => {
        const h = await ensure();
        return h.get(key);
      }),
    put: (key: string, data: Uint8Array | string) =>
      bridge.gate("write", ref, async () => {
        bridge.refuseDryRunWrite();
        const h = await ensure();
        return h.put(key, data);
      }),
  };

  return {
    ref,
    get driverId() {
      return cached?.driverId ?? "memory";
    },
    get(key) {
      return access.get(key);
    },
    list(prefix) {
      return bridge.gate("read", ref, async () => {
        const h = await ensure();
        return h.list(prefix);
      });
    },
    put(key, data) {
      return access.put(key, data);
    },
    delete(key) {
      return bridge.gate("write", ref, async () => {
        bridge.refuseDryRunWrite();
        const h = await ensure();
        return h.delete(key);
      });
    },
    image(source: string | Uint8Array, imageOpts?: FilesImageOptions) {
      return createFilesImagePipeline(access, source, imageOpts);
    },
    putImage(key: string, data: Uint8Array | string, putOpts?: PutImageOptions) {
      return bridge.gate("write", ref, async () => {
        bridge.refuseDryRunWrite();
        // putImage writes original + variants via bucket put; use ungated
        // runtime puts inside the single write effect.
        const h = await ensure();
        return putImageToBucket(
          { get: (k) => h.get(k), put: (k, d) => h.put(k, d) },
          key,
          data,
          putOpts,
        );
      });
    },
  };
}
