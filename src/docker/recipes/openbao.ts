/**
 * OpenBao image recipe — durable single-node secrets service (Raft storage).
 *
 * Never `-dev`: data lives on a named volume under `/openbao/data`; init +
 * unseal is handled by the CLI bootstrap (keys stay on the host).
 */

import type { ImageRecipe } from "../types.ts";

/**
 * Server config passed via `BAO_LOCAL_CONFIG` (official image). Single-node
 * Raft still requires `cluster_addr` / `api_addr` per the OpenBao docs.
 */
const OPENBAO_LOCAL_CONFIG = JSON.stringify({
  listener: { tcp: { address: "0.0.0.0:8200", tls_disable: true } },
  // Raft under /openbao/file — the stock entrypoint chowns that dir for the
  // `openbao` user; a root-owned fresh named volume stays writable. Raft does
  // not create nested dirs, so the path must be the chowned dir itself.
  storage: { raft: { path: "/openbao/file", node_id: "oke" } },
  api_addr: "http://0.0.0.0:8200",
  cluster_addr: "http://127.0.0.1:8201",
  disable_mlock: true,
});

/** OpenBao secrets service. API on 8200. */
export const openbao: ImageRecipe = {
  id: "openbao",
  port: 8200,
  match: (i) => /openbao/i.test(i),
  apply: (s) => ({
    environment: {
      BAO_LOCAL_CONFIG: OPENBAO_LOCAL_CONFIG,
    },
    command: ["server"],
    volumes: [`${s.serviceName}-data:/openbao/file`],
    healthcheck: {
      // `/sys/init` answers 200 even while sealed — only proves the server
      // process is up; bootstrap owns the real unseal step.
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8200/v1/sys/init >/dev/null 2>&1 || exit 1"],
      interval: "5s",
      timeout: "5s",
      retries: 12,
      start_period: "5s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}`,
};
