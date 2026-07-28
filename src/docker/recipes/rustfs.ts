/**
 * RustFS image recipe — S3-compatible object store (Apache 2.0 MinIO alternative).
 */

import { credEnv } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** S3-protocol object storage (RustFS). Console on 9001. */
export const rustfs: ImageRecipe = {
  id: "rustfs",
  port: 9000,
  match: (i) => /rustfs/i.test(i),
  apply: (s) => ({
    environment: {
      RUSTFS_ACCESS_KEY: credEnv(s, "USER"),
      RUSTFS_SECRET_KEY: credEnv(s, "PASSWORD"),
      RUSTFS_CONSOLE_ENABLE: "true",
      RUSTFS_ADDRESS: ":9000",
    },
    command: ["/data"],
    volumes: [`${s.serviceName}-data:/data`],
    extraPorts: [{ host: 9001, container: 9001 }],
    healthcheck: {
      test: ["CMD-SHELL", "curl -f http://127.0.0.1:9000/health || exit 1"],
      interval: "5s",
      timeout: "5s",
      retries: 12,
      start_period: "10s",
    },
  }),
  url: (_s, c) =>
    `http://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
