/**
 * `oke images pin` — tags → digests in `oke.images.lock`.
 */

/** One lock entry. */
export interface ImageLockEntry {
  readonly image: string;
  readonly digest: string;
  readonly pinnedAt: string;
}

/** Lock file shape. */
export interface ImagesLock {
  readonly oke: "1.0";
  readonly images: Readonly<Record<string, ImageLockEntry>>;
}

/** Resolve a tag to a digest (injectable for tests). */
export type DigestResolver = (image: string) => Promise<string>;

/**
 * Pin every image tag to a digest.
 *
 * @param images - Role → image tag
 * @param resolveDigest - Digest resolver (defaults to `docker buildx imagetools`)
 */
export async function pinImages(
  images: Readonly<Record<string, string>>,
  resolveDigest: DigestResolver = dockerDigest,
): Promise<ImagesLock> {
  const entries: Record<string, ImageLockEntry> = {};
  const pinnedAt = new Date().toISOString();
  for (const [role, image] of Object.entries(images)) {
    if (image.includes("@sha256:")) {
      entries[role] = { image, digest: image.split("@")[1]!, pinnedAt };
      continue;
    }
    const digest = await resolveDigest(image);
    entries[role] = {
      image: `${image.replace(/@sha256:[a-f0-9]+$/i, "")}@${digest}`,
      digest,
      pinnedAt,
    };
  }
  return { oke: "1.0", images: entries };
}

/**
 * Format lock file JSON.
 *
 * @param lock - Lock document
 */
export function formatImagesLock(lock: ImagesLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * Default digest resolver via `docker buildx imagetools inspect`.
 *
 * @param image - Image tag
 */
async function dockerDigest(image: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "docker",
      "buildx",
      "imagetools",
      "inspect",
      "--format",
      "{{.Manifest.Digest}}",
      image,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `oke images pin: failed to resolve ${image}: ${stderr.trim() || `exit ${code}`}`,
    );
  }
  const digest = stdout.trim();
  if (!digest.startsWith("sha256:")) {
    throw new Error(`oke images pin: unexpected digest for ${image}: ${digest}`);
  }
  return digest;
}
