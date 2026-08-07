/**
 * llama.cpp image recipe — default local AI (`ghcr.io/ggml-org/llama.cpp`).
 *
 * OpenAI-compatible `llama-server` on 8080. Pin ≥ {@link LLAMA_CPP_MIN_SAFE_BUILD}
 * (CVE-2026-27940 / CVE-2026-33298 floor). Host publish is loopback-only;
 * never publish RPC. Models via Docker Hub `ai/` — do not load arbitrary
 * untrusted GGUF files.
 *
 * b10290+ issues this recipe works around:
 * 1. Bare `--docker-repo` / router `--models-preset` children re-enter empty
 *    router mode (`is_router_server` only checks `-m` / `-hf`) → forever
 *    `loading`.
 * 2. `llama download -dr` only accepts `application/vnd.docker.ai.gguf.v3`;
 *    newer Hub models (e.g. gemma4) ship `vnd.cncf.model.weight.v1.raw`.
 *
 * Entrypoint: Hub-pull (native download, then CNCF-aware fallback) → serve
 * single-model with `-m` + `--alias`.
 */

import type { ImageRecipe } from "../types.ts";

/** Minimum safe llama.cpp build (GGUF parser CVEs through CVE-2026-27940). */
export const LLAMA_CPP_MIN_SAFE_BUILD = 8146;

/** Pinned default image — verified ≥ {@link LLAMA_CPP_MIN_SAFE_BUILD}; never `latest`. */
export const LLAMA_CPP_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-b10290";

/** Compose-relative entrypoint that downloads then serves one Hub model. */
export const LLAMA_CPP_ENTRYPOINT_FILE = "llama-entrypoint.py";

/** In-container path for {@link LLAMA_CPP_ENTRYPOINT_FILE}. */
export const LLAMA_CPP_ENTRYPOINT_MOUNT = "/oke/llama-entrypoint.py";

/**
 * Python entrypoint: pull curated Docker Hub `ai/` GGUF into the cache volume,
 * then `exec` `llama-server -m <gguf> --alias <id>` (single-model, not router).
 */
export function buildLlamaCppEntrypoint(): string {
  return `#!/usr/bin/env python3
"""OKE llama.cpp entrypoint — Hub-pull curated ai/ model, then serve single-model."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def cache_dir() -> str:
    return os.environ.get("LLAMA_CACHE", "/root/.cache/llama.cpp")


def parse_model(model: str) -> tuple[str, str]:
    raw = model.strip() or "smollm2"
    if "/" not in raw.split(":", 1)[0]:
        raw = f"ai/{raw}"
    if ":" in raw:
        repo, tag = raw.rsplit(":", 1)
    else:
        repo, tag = raw, "latest"
    return repo, tag


def expected_gguf(repo: str, tag: str) -> str:
    return f"{repo.replace('/', '_')}_{tag}.gguf"


def existing_gguf(path: str) -> str | None:
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return path
    return None


def llama_download(model: str) -> int:
    return subprocess.call(
        ["/app/llama", "download", "-dr", model, "--no-mmproj"],
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


def registry_token(repo: str) -> str:
    scope = urllib.parse.quote(f"repository:{repo}:pull", safe="")
    url = f"https://auth.docker.io/token?service=registry.docker.io&scope={scope}"
    with urllib.request.urlopen(url, timeout=60) as res:
        return json.load(res)["token"]


def fetch_manifest(repo: str, tag: str, token: str) -> dict:
    req = urllib.request.Request(
        f"https://registry-1.docker.io/v2/{repo}/manifests/{tag}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": (
                "application/vnd.oci.image.manifest.v1+json,"
                "application/vnd.docker.distribution.manifest.v2+json,"
                "application/vnd.oci.image.index.v1+json,"
                "application/vnd.docker.distribution.manifest.list.v2+json"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def pick_gguf_layer(manifest: dict) -> tuple[str, str]:
    """Return (digest, suggested_filename) for the primary GGUF weight layer."""
    layers = manifest.get("layers") or []
    candidates: list[tuple[str, str, int]] = []
    for layer in layers:
        media = str(layer.get("mediaType") or "")
        digest = str(layer.get("digest") or "")
        ann = layer.get("annotations") or {}
        filepath = str(ann.get("org.cncf.model.filepath") or "")
        name = filepath.split("/")[-1] if filepath else ""
        is_gguf = (
            media == "application/vnd.docker.ai.gguf.v3"
            or "gguf" in media.lower()
            or name.lower().endswith(".gguf")
        )
        if not is_gguf or not digest:
            continue
        if name.lower().startswith("mmproj"):
            continue
        size = int(layer.get("size") or 0)
        candidates.append((digest, name or "model.gguf", size))
    if not candidates:
        raise RuntimeError("No GGUF weight layer in Docker / CNCF model manifest")
    # Prefer the largest non-mmproj GGUF (main weights vs projectors).
    candidates.sort(key=lambda c: c[2], reverse=True)
    digest, name, _ = candidates[0]
    return digest, name


def download_blob(repo: str, digest: str, token: str, dest: str) -> None:
    url = f"https://registry-1.docker.io/v2/{repo}/blobs/{digest}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    partial = f"{dest}.partial"
    print(f"oke ai: downloading {digest} → {dest}", flush=True)
    with urllib.request.urlopen(req, timeout=600) as res, open(partial, "wb") as out:
        total = int(res.headers.get("Content-Length") or 0)
        done = 0
        last_pct = -1
        while True:
            chunk = res.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = (100 * done) // total
                if pct >= last_pct + 5 or done == total:
                    last_pct = pct
                    print(
                        f"oke ai: download {pct}% ({done // (1024 * 1024)} / {total // (1024 * 1024)} MiB)",
                        flush=True,
                    )
    os.replace(partial, dest)


def hub_pull(repo: str, tag: str, dest: str) -> None:
    token = registry_token(repo)
    manifest = fetch_manifest(repo, tag, token)
    # Index → pick first linux manifest if present.
    if "manifests" in manifest:
        digests = [m.get("digest") for m in manifest["manifests"] if m.get("digest")]
        if not digests:
            raise RuntimeError("Empty OCI index for model")
        req = urllib.request.Request(
            f"https://registry-1.docker.io/v2/{repo}/manifests/{digests[0]}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            manifest = json.load(res)
    digest, _name = pick_gguf_layer(manifest)
    download_blob(repo, digest, token, dest)


def ensure_model(model: str) -> str:
    repo, tag = parse_model(model)
    # llama download -dr expects id without forced ai/ prefix when using default org.
    dr = model.strip() or "smollm2"
    if dr.startswith("ai/"):
        dr = dr[3:]
    dest = os.path.join(cache_dir(), expected_gguf(repo, tag))
    hit = existing_gguf(dest)
    if hit:
        print(f"oke ai: using cached {hit}", flush=True)
        return hit

    print(f"oke ai: ensuring Docker Hub model '{dr}' is cached…", flush=True)
    rc = llama_download(dr)
    hit = existing_gguf(dest)
    if hit:
        return hit
    # Native downloader may write the same basename; also accept exact path only.
    print(
        f"oke ai: native download exit {rc}; trying CNCF / Hub registry pull…",
        flush=True,
    )
    try:
        hub_pull(repo, tag, dest)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError, KeyError, ValueError) as err:
        print(f"oke ai: failed to download model '{dr}': {err}", file=sys.stderr, flush=True)
        sys.exit(1)
    hit = existing_gguf(dest)
    if not hit:
        print(f"oke ai: download produced no file at {dest}", file=sys.stderr, flush=True)
        sys.exit(1)
    return hit


def main() -> None:
    model = (os.environ.get("OKE_AI_MODEL") or "smollm2").strip() or "smollm2"
    gguf = ensure_model(model)
    print(f"oke ai: serving {model} from {gguf}", flush=True)
    os.execv(
        "/app/llama-server",
        [
            "/app/llama-server",
            "--host",
            "0.0.0.0",
            "--port",
            "8080",
            "--model",
            gguf,
            "--alias",
            model,
        ],
    )


if __name__ == "__main__":
    main()
`;
}

/** llama-server — OpenAI-compatible HTTP on 8080; loopback publish only. */
export const llamaCpp: ImageRecipe = {
  id: "llama-cpp",
  port: 8080,
  match: (i) => /llama\.cpp|llamacpp/i.test(i),
  apply: (s) => ({
    // OKE_AI_MODEL comes from compose `env_file` (`.env.docker`). Do not
    // re-declare it as `${OKE_AI_MODEL:-smollm2}` here — Compose interpolates
    // that from the *host* shell and can override the stack file with the
    // default. Never set LLAMA_ARG_MODELS_PRESET / LLAMA_ARG_DOCKER_REPO
    // (router children inherit `LLAMA_ARG_*` and can OOM).
    entrypoint: ["/usr/bin/python3", LLAMA_CPP_ENTRYPOINT_MOUNT],
    volumes: [
      `${s.serviceName}-models:/root/.cache`,
      `./${LLAMA_CPP_ENTRYPOINT_FILE}:${LLAMA_CPP_ENTRYPOINT_MOUNT}:ro`,
    ],
    publishBind: "127.0.0.1",
    healthcheck: {
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1"],
      interval: "5s",
      timeout: "5s",
      retries: 24,
      // First boot may download a multi‑GB Hub model (CNCF pull) into cache.
      start_period: "900s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}/v1`,
};
