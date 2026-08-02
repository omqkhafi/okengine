/**
 * Files image pipeline — Bun.Image over memory files driver + fx gating.
 */

import { describe, expect, test } from "bun:test";
import { memoryFilesDriver } from "../../drivers/memory.ts";
import { createFxContext } from "../../kernel/fx.ts";
import { createFilesImagePipeline, putImageToBucket, variantObjectKey } from "./files-image.ts";
import { createStoreRuntime, store, type FilesStoreFxHandle } from "../store.ts";

/** Valid 32×32 red PNG (zlib). */
const PNG_32 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 32, 0, 0, 0, 32, 8, 2, 0,
  0, 0, 252, 24, 237, 163, 0, 0, 0, 40, 73, 68, 65, 84, 120, 156, 237, 205, 177, 13, 0, 0, 12, 194,
  48, 254, 127, 186, 125, 2, 54, 75, 153, 227, 92, 50, 109, 123, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 197,
  30, 50, 195, 252, 46, 60, 190, 144, 144, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function asFiles(handle: unknown): FilesStoreFxHandle {
  if (
    !handle ||
    typeof handle !== "object" ||
    !("image" in handle) ||
    typeof (handle as FilesStoreFxHandle).image !== "function"
  ) {
    throw new Error("expected files handle");
  }
  return handle as FilesStoreFxHandle;
}

describe("variantObjectKey", () => {
  test("strips extension and appends variant + format", () => {
    expect(variantObjectKey("photos/x.jpg", "thumb", "webp")).toBe("photos/x.thumb.webp");
    expect(variantObjectKey("x.png", "medium", "jpeg")).toBe("x.medium.jpg");
    expect(variantObjectKey("noext", "thumb", "png")).toBe("noext.thumb.png");
  });
});

describe("files image pipeline (bucket)", () => {
  test("metadata / resize→webp / put / missing key", async () => {
    const bucket = await memoryFilesDriver.open({ name: "img" });
    const access = {
      get: (key: string) => bucket.get(key),
      put: (key: string, data: Uint8Array | string) => bucket.put(key, data),
    };
    await access.put("orig.png", PNG_32);

    const meta = await createFilesImagePipeline(access, "orig.png").metadata();
    expect(meta).toEqual({ width: 32, height: 32, format: "png" });

    await createFilesImagePipeline(access, "orig.png")
      .resize(16, 16, { fit: "inside" })
      .webp({ quality: 80 })
      .put("thumb.webp");
    const thumb = await access.get("thumb.webp");
    expect(thumb).not.toBeNull();
    expect(thumb!.byteLength).toBeGreaterThan(0);
    const thumbMeta = await new Bun.Image(thumb!).metadata();
    expect(thumbMeta.format).toBe("webp");
    expect(thumbMeta.width).toBeLessThanOrEqual(16);
    expect(thumbMeta.height).toBeLessThanOrEqual(16);

    await expect(createFilesImagePipeline(access, "missing.png").metadata()).rejects.toThrow(
      /object not found/,
    );
  });

  test("putImage writes original, variants, and placeholder", async () => {
    const bucket = await memoryFilesDriver.open({ name: "img2" });
    const access = {
      get: (key: string) => bucket.get(key),
      put: (key: string, data: Uint8Array | string) => bucket.put(key, data),
    };

    const result = await putImageToBucket(access, "photos/x.png", PNG_32, {
      variants: {
        thumb: { resize: [16, 16, { fit: "inside" }], webp: { quality: 80 } },
        medium: { resize: [24], webp: { quality: 85 } },
      },
      placeholder: true,
    });

    expect(result.key).toBe("photos/x.png");
    expect(result.meta).toEqual({ width: 32, height: 32, format: "png" });
    expect(result.variants).toEqual({
      thumb: "photos/x.thumb.webp",
      medium: "photos/x.medium.webp",
    });
    expect(result.placeholder?.startsWith("data:image/png;base64,")).toBe(true);

    expect(await access.get("photos/x.png")).not.toBeNull();
    expect(await access.get("photos/x.thumb.webp")).not.toBeNull();
    expect(await access.get("photos/x.medium.webp")).not.toBeNull();
  });
});

describe("files image via fx.store", () => {
  test("image() chains sync; terminals record read/write", async () => {
    const decl = store.files("uploads");
    const runtime = createStoreRuntime({
      drivers: { files: memoryFilesDriver },
    });
    runtime.register(decl);

    const { fx, ledger } = createFxContext({
      flow: "img-flow",
      effects: { reads: ["files:uploads"], writes: ["files:uploads"] },
      storeRuntime: runtime,
    });

    const files = fx.store(decl) as FilesStoreFxHandle;
    await files.put("hero.png", PNG_32);

    const pipeline = files.image("hero.png");
    expect(typeof pipeline.resize).toBe("function");
    expect(pipeline).not.toBeInstanceOf(Promise);

    const meta = await pipeline.metadata();
    expect(meta.width).toBe(32);

    await files
      .image("hero.png")
      .resize(8, 8, { fit: "inside" })
      .webp({ quality: 70 })
      .put("hero.thumb.webp");

    const putImage = await files.putImage("a.png", PNG_32, {
      variants: { thumb: { resize: [8], webp: { quality: 70 } } },
      placeholder: true,
    });
    expect(putImage.variants.thumb).toBe("a.thumb.webp");

    const kinds = ledger.entries.map((e) => e.kind);
    expect(kinds).toContain("read");
    expect(kinds).toContain("write");
  });

  test("runtime handle exposes image + putImage", async () => {
    const decl = store.files("direct");
    const runtime = createStoreRuntime({
      drivers: { files: memoryFilesDriver },
    });
    runtime.register(decl);
    const handle = asFiles(
      await runtime.open(decl, {
        effects: { reads: ["files:direct"], writes: ["files:direct"] },
      }),
    );
    const fromBytes = await handle.image(PNG_32).placeholder();
    expect(fromBytes.startsWith("data:image/png;base64,")).toBe(true);
  });
});
