/**
 * Traefik image recipe — Docker-label auto-discovery reverse proxy.
 *
 * Opt-in via `images.proxy`. Scaled `app` replicas
 * (`docker compose up --scale app=N`) are discovered via the Docker
 * provider — no Caddyfile-style reconfiguration.
 *
 * Security: the recipe never mounts the raw Docker socket into Traefik.
 * A `tecnativa/docker-socket-proxy` companion exposes a filtered API
 * (containers/events/ping/version only) on the internal compose network.
 * Traefik’s own docs recommend this pattern for Docker API access.
 */

import { APP_PORT } from "../../runtime/types.ts";
import type { ImageRecipe } from "../types.ts";

/** Filtered Docker API proxy — only this service mounts `docker.sock`. */
export const SOCKET_PROXY_IMAGE = "tecnativa/docker-socket-proxy:v0.5.0";

/** Compose service name for the socket proxy companion. */
export const SOCKET_PROXY_SERVICE = "socket-proxy";

/** Traefik routing labels applied to the `app` service. */
export function traefikAppLabels(appPort: number = APP_PORT): Record<string, string> {
  return {
    "traefik.enable": "true",
    "traefik.http.routers.app.rule": "Host(`${OKE_PROXY_HOST:-localhost}`)",
    "traefik.http.routers.app.entrypoints": "websecure",
    "traefik.http.routers.app.tls.certresolver": "letsencrypt",
    "traefik.http.services.app.loadbalancer.server.port": String(appPort),
  };
}

/** Traefik reverse proxy. HTTP 80 + HTTPS 443; Docker provider via socket-proxy. */
export const traefik: ImageRecipe = {
  id: "traefik",
  port: 80,
  match: (i) => /traefik/i.test(i),
  apply: () => ({
    extraPorts: [{ host: 443, container: 443 }],
    command: [
      "--ping=true",
      "--providers.docker=true",
      `--providers.docker.endpoint=tcp://${SOCKET_PROXY_SERVICE}:2375`,
      "--providers.docker.exposedbydefault=false",
      "--entrypoints.web.address=:80",
      "--entrypoints.websecure.address=:443",
      "--entrypoints.web.http.redirections.entrypoint.to=websecure",
      "--certificatesresolvers.letsencrypt.acme.httpchallenge=true",
      "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
      "--certificatesresolvers.letsencrypt.acme.email=${OKE_PROXY_ACME_EMAIL:-admin@example.com}",
      "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json",
    ],
    volumes: ["proxy-letsencrypt:/letsencrypt"],
    dependsOn: {
      [SOCKET_PROXY_SERVICE]: { condition: "service_started" },
    },
    healthcheck: {
      test: ["CMD", "traefik", "healthcheck", "--ping"],
      interval: "10s",
      timeout: "3s",
      retries: 5,
    },
    services: {
      [SOCKET_PROXY_SERVICE]: {
        image: SOCKET_PROXY_IMAGE,
        environment: {
          CONTAINERS: "1",
          EVENTS: "1",
          PING: "1",
          VERSION: "1",
          NETWORKS: "1",
        },
        volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
        networks: ["oke"],
      },
      app: {
        labels: traefikAppLabels(),
      },
    },
  }),
  url: (_s, c) => `https://${c.host}`,
};
