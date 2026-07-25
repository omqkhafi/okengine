/**
 * Derive Dockerfile + compose files from config image pins.
 */

import {
  assertNoCredentialsInYaml,
  buildSpecs,
  buildStackEnv,
  emitComposeLayers,
  formatStackEnv,
} from "./compose.ts";
import { emitDockerfile } from "./dockerfile.ts";
import type { DeriveOptions, DeriveResult, GeneratedFile } from "./types.ts";

/**
 * Derive infrastructure files from normalised image pins.
 *
 * Credentials land only in the returned `stackEnv` (for `.env.stack`);
 * generated YAML never contains cleartext secrets. Layer 4
 * (`compose.override.yml`) is listed in `composeFiles` but never written.
 *
 * @param options - Images / app / prod flag
 */
export function deriveInfrastructure(options: DeriveOptions): DeriveResult {
  if (!options.images || Object.keys(options.images).length === 0) {
    throw new Error(
      "oke docker: no images configured — set `images` in oke.config.ts (or prod drivers postgres/redis for defaults)",
    );
  }

  const specs = buildSpecs(options);
  const { files: composeFilesContent, composeFiles } = emitComposeLayers(
    specs,
    options,
  );
  const dockerfile: GeneratedFile = {
    path: "Dockerfile",
    content: emitDockerfile({ appPort: options.appPort }),
  };
  const files = [dockerfile, ...composeFilesContent];

  for (const f of files) {
    if (f.path.endsWith(".yml") || f.path === "Dockerfile") {
      assertNoCredentialsInYaml(
        f.content,
        specs.map((s) => s.credentials),
      );
    }
  }

  const stackEnv = buildStackEnv(
    specs,
    options.recipes ?? [],
    options.host ?? "127.0.0.1",
  );

  return { specs, files, stackEnv, composeFiles };
}

/**
 * Write derived files to disk. Never writes `compose.override.yml` or
 * credential values into YAML. Optionally writes `.env.stack`.
 *
 * @param result - Derive result
 * @param outDir - Destination
 * @param options - Write controls
 */
export async function writeDerivedFiles(
  result: DeriveResult,
  outDir: string,
  options: { readonly writeStackEnv?: boolean } = {},
): Promise<readonly string[]> {
  const written: string[] = [];
  for (const file of result.files) {
    const path = `${outDir.replace(/\/$/, "")}/${file.path}`;
    await Bun.write(path, file.content);
    written.push(path);
  }
  if (options.writeStackEnv) {
    const envPath = `${outDir.replace(/\/$/, "")}/.env.stack`;
    await Bun.write(envPath, formatStackEnv(result.stackEnv));
    written.push(envPath);
  }
  return written;
}
