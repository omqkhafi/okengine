/**
 * Files facet image pipeline — Bun.Image over bucket get/put.
 *
 * Drivers stay blob CRUD; decode / transform / encode live here so every
 * store access still goes through the files handle (and fx gating).
 */

/**
 * Default decompression-bomb ceiling — `4096 × 4096` (16 MP).
 *
 * Rationale: covers typical phone / web uploads (4K ≈ 8.3 MP) while refusing
 * header-claimed canvases that would allocate multi-hundred-MB pixel buffers.
 * Raise with `maxPixels`, or pass `false` to disable (explicit opt-out).
 */
export const DEFAULT_FILES_IMAGE_MAX_PIXELS = 4096 * 4096;

/** Image dimensions + sniffed format (header only — no full decode). */
export interface FilesImageMeta {
  readonly width: number;
  readonly height: number;
  readonly format: string;
}

/** Bun.Image constructor guards. */
export interface FilesImageOptions {
  /**
   * Reject when width×height exceeds this (checked after header, before the
   * pixel buffer). Default {@link DEFAULT_FILES_IMAGE_MAX_PIXELS}. Pass
   * `false` to disable the guard.
   */
  readonly maxPixels?: number | false;
  /** Apply JPEG EXIF Orientation before other ops. Default true. */
  readonly autoOrient?: boolean;
}

/** Resize options (Bun.Image / Sharp-shaped). */
export interface FilesImageResizeOptions {
  readonly filter?:
    | "nearest"
    | "box"
    | "bilinear"
    | "linear"
    | "cubic"
    | "mitchell"
    | "lanczos2"
    | "lanczos3"
    | "mks2013"
    | "mks2021";
  readonly fit?: "fill" | "inside";
  readonly withoutEnlargement?: boolean;
}

/** Brightness / saturation multipliers. */
export interface FilesImageModulateOptions {
  readonly brightness?: number;
  readonly saturation?: number;
}

/** JPEG encode options. */
export interface FilesImageJpegOptions {
  readonly quality?: number;
  readonly progressive?: boolean;
}

/** PNG encode options. */
export interface FilesImagePngOptions {
  readonly compressionLevel?: number;
  readonly palette?: boolean;
  readonly colors?: number;
  readonly dither?: boolean;
}

/** WebP encode options. */
export interface FilesImageWebpOptions {
  readonly quality?: number;
  readonly lossless?: boolean;
}

/** HEIC / AVIF quality (platform codecs). */
export interface FilesImageQualityOptions {
  readonly quality?: number;
}

/** Portable + platform encode targets. */
export type FilesImageFormat = "jpeg" | "png" | "webp" | "heic" | "avif";

/**
 * One named derivative for {@link PutImageOptions.variants}.
 *
 * `resize` is a Sharp-style tuple: `[width]`, `[width, height]`, or
 * `[width, height, options]`. Set exactly one of `jpeg` / `png` / `webp` /
 * `heic` / `avif` to choose the encode target (default: source format, or
 * `webp` when the source is decode-only).
 */
export interface ImageVariantSpec {
  readonly resize?:
    | readonly [width: number]
    | readonly [width: number, height: number]
    | readonly [width: number, height: number, options: FilesImageResizeOptions];
  readonly rotate?: number;
  readonly flip?: boolean;
  readonly flop?: boolean;
  readonly modulate?: FilesImageModulateOptions;
  readonly jpeg?: FilesImageJpegOptions;
  readonly png?: FilesImagePngOptions;
  readonly webp?: FilesImageWebpOptions;
  readonly heic?: FilesImageQualityOptions;
  readonly avif?: FilesImageQualityOptions;
}

/** Options for {@link putImageToBucket}. */
export interface PutImageOptions {
  /** Named derivatives written beside the original. */
  readonly variants?: Readonly<Record<string, ImageVariantSpec>>;
  /** Include a ThumbHash LQIP data URL on the result. */
  readonly placeholder?: boolean;
  /**
   * Pixel ceiling — default {@link DEFAULT_FILES_IMAGE_MAX_PIXELS}.
   * Pass `false` to disable.
   */
  readonly maxPixels?: number | false;
  readonly autoOrient?: boolean;
}

/** Result of {@link putImageToBucket}. */
export interface PutImageResult {
  readonly key: string;
  readonly meta: FilesImageMeta;
  readonly variants: Readonly<Record<string, string>>;
  readonly placeholder?: string;
}

/** Bucket accessors used by the pipeline (gated or raw). */
export interface FilesImageBucketAccess {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array | string): Promise<void>;
}

/** Chainable image pipeline on a files store. */
export interface FilesImagePipeline {
  resize(width: number, height?: number, options?: FilesImageResizeOptions): FilesImagePipeline;
  rotate(degrees: number): FilesImagePipeline;
  flip(): FilesImagePipeline;
  flop(): FilesImagePipeline;
  modulate(options: FilesImageModulateOptions): FilesImagePipeline;
  jpeg(options?: FilesImageJpegOptions): FilesImagePipeline;
  png(options?: FilesImagePngOptions): FilesImagePipeline;
  webp(options?: FilesImageWebpOptions): FilesImagePipeline;
  heic(options?: FilesImageQualityOptions): FilesImagePipeline;
  avif(options?: FilesImageQualityOptions): FilesImagePipeline;
  metadata(): Promise<FilesImageMeta>;
  bytes(): Promise<Uint8Array>;
  blob(): Promise<Blob>;
  placeholder(): Promise<string>;
  put(outKey: string): Promise<void>;
}

type Op =
  | {
      readonly kind: "resize";
      readonly width: number;
      readonly height?: number;
      readonly options?: FilesImageResizeOptions;
    }
  | { readonly kind: "rotate"; readonly degrees: number }
  | { readonly kind: "flip" }
  | { readonly kind: "flop" }
  | { readonly kind: "modulate"; readonly options: FilesImageModulateOptions };

type FormatOp =
  | { readonly format: "jpeg"; readonly options?: FilesImageJpegOptions }
  | { readonly format: "png"; readonly options?: FilesImagePngOptions }
  | { readonly format: "webp"; readonly options?: FilesImageWebpOptions }
  | { readonly format: "heic"; readonly options?: FilesImageQualityOptions }
  | { readonly format: "avif"; readonly options?: FilesImageQualityOptions };

function isImageError(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === code
  );
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/**
 * Resolve Bun.Image constructor options — `maxPixels` always set
 * (secure-by-default; never omit the guard).
 *
 * @param opts - Caller options
 */
export function resolveFilesImageCtorOptions(
  opts?: FilesImageOptions,
): Bun.Image.ConstructorOptions {
  const maxPixels =
    opts?.maxPixels === false
      ? Number.POSITIVE_INFINITY
      : (opts?.maxPixels ?? DEFAULT_FILES_IMAGE_MAX_PIXELS);
  const out: Bun.Image.ConstructorOptions = { maxPixels };
  if (opts?.autoOrient !== undefined) out.autoOrient = opts.autoOrient;
  return out;
}

function applyOps(img: Bun.Image, ops: readonly Op[]): Bun.Image {
  let cur = img;
  for (const op of ops) {
    if (op.kind === "resize") cur = cur.resize(op.width, op.height, op.options);
    else if (op.kind === "rotate") cur = cur.rotate(op.degrees);
    else if (op.kind === "flip") cur = cur.flip();
    else if (op.kind === "flop") cur = cur.flop();
    else cur = cur.modulate(op.options);
  }
  return cur;
}

function applyFormat(img: Bun.Image, formatOp: FormatOp | undefined): Bun.Image {
  if (!formatOp) return img;
  if (formatOp.format === "jpeg") return img.jpeg(formatOp.options);
  if (formatOp.format === "png") return img.png(formatOp.options);
  if (formatOp.format === "webp") return img.webp(formatOp.options);
  if (formatOp.format === "heic") return img.heic(formatOp.options);
  return img.avif(formatOp.options);
}

async function encodeBytes(
  input: Uint8Array,
  options: FilesImageOptions | undefined,
  ops: readonly Op[],
  formatOp: FormatOp | undefined,
): Promise<Uint8Array> {
  const buildBase = (): Bun.Image =>
    applyOps(new Bun.Image(input, resolveFilesImageCtorOptions(options)), ops);
  try {
    return await applyFormat(buildBase(), formatOp).bytes();
  } catch (err) {
    if (
      formatOp &&
      (formatOp.format === "avif" || formatOp.format === "heic") &&
      isImageError(err, "ERR_IMAGE_FORMAT_UNSUPPORTED")
    ) {
      const quality =
        formatOp.options && "quality" in formatOp.options ? formatOp.options.quality : 80;
      return await buildBase()
        .webp({ quality: quality ?? 80 })
        .bytes();
    }
    throw err;
  }
}

function formatFromSpec(spec: ImageVariantSpec): FormatOp | undefined {
  const set = [
    spec.jpeg !== undefined ? ("jpeg" as const) : undefined,
    spec.png !== undefined ? ("png" as const) : undefined,
    spec.webp !== undefined ? ("webp" as const) : undefined,
    spec.heic !== undefined ? ("heic" as const) : undefined,
    spec.avif !== undefined ? ("avif" as const) : undefined,
  ].filter((f): f is FilesImageFormat => f !== undefined);
  if (set.length > 1) {
    throw new Error(
      `files image variant: set only one of jpeg/png/webp/heic/avif (got ${set.join(", ")})`,
    );
  }
  const format = set[0];
  if (!format) return undefined;
  if (format === "jpeg") return { format, options: spec.jpeg };
  if (format === "png") return { format, options: spec.png };
  if (format === "webp") return { format, options: spec.webp };
  if (format === "heic") return { format, options: spec.heic };
  return { format, options: spec.avif };
}

function opsFromSpec(spec: ImageVariantSpec): Op[] {
  const ops: Op[] = [];
  if (spec.resize) {
    const width = spec.resize[0];
    const height = typeof spec.resize[1] === "number" ? spec.resize[1] : undefined;
    const options = spec.resize.length === 3 ? spec.resize[2] : undefined;
    ops.push({ kind: "resize", width, height, options });
  }
  if (spec.rotate !== undefined) ops.push({ kind: "rotate", degrees: spec.rotate });
  if (spec.flip) ops.push({ kind: "flip" });
  if (spec.flop) ops.push({ kind: "flop" });
  if (spec.modulate) ops.push({ kind: "modulate", options: spec.modulate });
  return ops;
}

/**
 * Object key for a named variant: `photos/x.jpg` + `thumb` + `webp`
 * → `photos/x.thumb.webp`.
 *
 * @param sourceKey - Original object key
 * @param variantName - Variant id (e.g. `thumb`)
 * @param format - Encode format id
 */
export function variantObjectKey(
  sourceKey: string,
  variantName: string,
  format: FilesImageFormat | string,
): string {
  const slash = sourceKey.lastIndexOf("/");
  const dir = slash >= 0 ? sourceKey.slice(0, slash + 1) : "";
  const base = slash >= 0 ? sourceKey.slice(slash + 1) : sourceKey;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = format === "jpeg" ? "jpg" : format;
  return `${dir}${stem}.${variantName}.${ext}`;
}

function resolveEncodeFormat(
  formatOp: FormatOp | undefined,
  sourceFormat: string,
): FilesImageFormat {
  if (formatOp) return formatOp.format;
  if (
    sourceFormat === "jpeg" ||
    sourceFormat === "png" ||
    sourceFormat === "webp" ||
    sourceFormat === "heic" ||
    sourceFormat === "avif"
  ) {
    return sourceFormat;
  }
  // Decode-only sources (gif/bmp/tiff) — portable default.
  return "webp";
}

/**
 * Build a chainable image pipeline over bucket accessors.
 *
 * @param access - get/put (may be fx-gated)
 * @param source - Object key or raw bytes
 * @param options - Bun.Image constructor options
 */
export function createFilesImagePipeline(
  access: FilesImageBucketAccess,
  source: string | Uint8Array,
  options?: FilesImageOptions,
): FilesImagePipeline {
  const ops: Op[] = [];
  let formatOp: FormatOp | undefined;

  async function resolveSource(): Promise<Uint8Array> {
    if (typeof source !== "string") return source;
    const data = await access.get(source);
    if (data == null) {
      throw new Error(`files image: object not found: ${source}`);
    }
    return data;
  }

  const pipeline: FilesImagePipeline = {
    resize(width, height, resizeOpts) {
      ops.push({ kind: "resize", width, height, options: resizeOpts });
      return pipeline;
    },
    rotate(degrees) {
      ops.push({ kind: "rotate", degrees });
      return pipeline;
    },
    flip() {
      ops.push({ kind: "flip" });
      return pipeline;
    },
    flop() {
      ops.push({ kind: "flop" });
      return pipeline;
    },
    modulate(modOpts) {
      ops.push({ kind: "modulate", options: modOpts });
      return pipeline;
    },
    jpeg(jpegOpts) {
      formatOp = { format: "jpeg", options: jpegOpts };
      return pipeline;
    },
    png(pngOpts) {
      formatOp = { format: "png", options: pngOpts };
      return pipeline;
    },
    webp(webpOpts) {
      formatOp = { format: "webp", options: webpOpts };
      return pipeline;
    },
    heic(heicOpts) {
      formatOp = { format: "heic", options: heicOpts };
      return pipeline;
    },
    avif(avifOpts) {
      formatOp = { format: "avif", options: avifOpts };
      return pipeline;
    },
    async metadata() {
      const input = await resolveSource();
      const meta = await new Bun.Image(input, resolveFilesImageCtorOptions(options)).metadata();
      return { width: meta.width, height: meta.height, format: meta.format };
    },
    async bytes() {
      return encodeBytes(await resolveSource(), options, ops, formatOp);
    },
    async blob() {
      const input = await resolveSource();
      const buildBase = (): Bun.Image =>
        applyOps(new Bun.Image(input, resolveFilesImageCtorOptions(options)), ops);
      try {
        return await applyFormat(buildBase(), formatOp).blob();
      } catch (err) {
        if (
          formatOp &&
          (formatOp.format === "avif" || formatOp.format === "heic") &&
          isImageError(err, "ERR_IMAGE_FORMAT_UNSUPPORTED")
        ) {
          const quality =
            formatOp.options && "quality" in formatOp.options ? formatOp.options.quality : 80;
          return await buildBase()
            .webp({ quality: quality ?? 80 })
            .blob();
        }
        throw err;
      }
    },
    async placeholder() {
      const input = await resolveSource();
      return new Bun.Image(input, resolveFilesImageCtorOptions(options)).placeholder();
    },
    async put(outKey) {
      const encoded = await encodeBytes(await resolveSource(), options, ops, formatOp);
      await access.put(outKey, encoded);
    },
  };

  return pipeline;
}

/**
 * Write an original image plus optional named variants / LQIP.
 *
 * @param access - get/put (may be fx-gated)
 * @param key - Object key for the original
 * @param data - Image bytes (or UTF-8 string, same as `put`)
 * @param opts - Variants / placeholder / Bun.Image guards
 */
export async function putImageToBucket(
  access: FilesImageBucketAccess,
  key: string,
  data: Uint8Array | string,
  opts?: PutImageOptions,
): Promise<PutImageResult> {
  const input = toBytes(data);
  const imageOpts: FilesImageOptions = {
    maxPixels: opts?.maxPixels,
    autoOrient: opts?.autoOrient,
  };
  const metaRaw = await new Bun.Image(input, resolveFilesImageCtorOptions(imageOpts)).metadata();
  const meta: FilesImageMeta = {
    width: metaRaw.width,
    height: metaRaw.height,
    format: metaRaw.format,
  };

  await access.put(key, input);

  const variants: Record<string, string> = {};
  for (const [name, spec] of Object.entries(opts?.variants ?? {})) {
    const formatOp = formatFromSpec(spec);
    const encodeFormat = resolveEncodeFormat(formatOp, meta.format);
    const effectiveFormat: FormatOp =
      formatOp ??
      (encodeFormat === "jpeg"
        ? { format: "jpeg" }
        : encodeFormat === "png"
          ? { format: "png" }
          : encodeFormat === "heic"
            ? { format: "heic" }
            : encodeFormat === "avif"
              ? { format: "avif" }
              : { format: "webp" });
    const outKey = variantObjectKey(key, name, encodeFormat);
    const encoded = await encodeBytes(input, imageOpts, opsFromSpec(spec), effectiveFormat);
    await access.put(outKey, encoded);
    variants[name] = outKey;
  }

  let placeholder: string | undefined;
  if (opts?.placeholder) {
    placeholder = await new Bun.Image(input, resolveFilesImageCtorOptions(imageOpts)).placeholder();
  }

  return { key, meta, variants, placeholder };
}
