/**
 * Docs sidebar icons — Lucide for product surfaces, monochrome brand marks for
 * Recipes, Providers, and OAuth plugin pages (fill inherits sidebar ink).
 */

import type { LoaderPlugin } from "fumadocs-core/source";
import { icons, type LucideIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { BRAND_MARKS, type BrandMarkId } from "@/components/chrome/brand-marks";

/**
 * Lucide icon names keyed by docs URL path (better-auth sidebar-content pattern).
 */
const PATH_ICONS: Readonly<Record<string, keyof typeof icons>> = {
  "/docs": "BookOpen",
  "/docs/concepts": "Sparkles",
  "/docs/concepts/why": "Compass",
  "/docs/concepts/model": "Boxes",
  "/docs/concepts/law": "Workflow",
  "/docs/concepts/effects": "Braces",
  "/docs/concepts/routing": "GitFork",
  "/docs/concepts/manifest": "FileCode",
  "/docs/concepts/architecture": "Cpu",
  "/docs/understand": "Compass",
  "/docs/understand/the-problem": "TriangleAlert",
  "/docs/understand/the-model": "Compass",
  "/docs/understand/the-vocabulary": "Boxes",
  "/docs/understand/see-it-work": "Eye",
  "/docs/ai/try-it": "Terminal",
  "/docs/get-started": "Rocket",
  "/docs/get-started/introduction": "BookOpen",
  "/docs/get-started/why": "Compass",
  "/docs/get-started/installation": "Download",
  "/docs/get-started/basic-usage": "SquareTerminal",
  "/docs/get-started/testing": "FlaskConical",
  "/docs/get-started/project-structure": "FolderTree",
  "/docs/elements": "Boxes",
  "/docs/elements/flow": "Workflow",
  "/docs/elements/flow/http": "Globe",
  "/docs/elements/flow/jobs": "Clock",
  "/docs/elements/flow/consumers": "Radio",
  "/docs/elements/flow/workflows": "GitFork",
  "/docs/elements/signal": "Radio",
  "/docs/elements/signal/queues": "ListOrdered",
  "/docs/elements/signal/pubsub": "Share2",
  "/docs/elements/signal/streams": "Activity",
  "/docs/elements/store": "Database",
  "/docs/elements/store/sql": "Table",
  "/docs/elements/store/kv": "Key",
  "/docs/elements/store/files": "Files",
  "/docs/elements/store/search": "Search",
  "/docs/elements/clock": "Clock",
  "/docs/elements/clock/schedules": "Calendar",
  "/docs/elements/clock/intervals": "Timer",
  "/docs/elements/clock/sleep": "Moon",
  "/docs/elements/gate": "ShieldCheck",
  "/docs/elements/gate/auth": "Lock",
  "/docs/elements/gate/tenancy": "Building2",
  "/docs/elements/gate/authorization": "ShieldAlert",
  "/docs/elements/gate/rate-limits": "Gauge",
  "/docs/elements/vault": "KeyRound",
  "/docs/elements/vault/secrets": "Key",
  "/docs/elements/vault/config": "SlidersHorizontal",
  "/docs/elements/vault/rotation": "RefreshCw",
  "/docs/elements/channel": "Mail",
  "/docs/elements/channel/email": "Mail",
  "/docs/elements/channel/sms": "MessageSquare",
  "/docs/elements/channel/push": "Bell",
  "/docs/elements/channel/receipts": "ReceiptText",
  "/docs/elements/ai": "Sparkles",
  "/docs/elements/ai/models": "Cpu",
  "/docs/elements/ai/prompts": "FileCode",
  "/docs/elements/ai/agents": "Bot",
  "/docs/elements/ai/mcp": "Plug",
  "/docs/deployment": "Server",
  "/docs/deployment/docker": "Package",
  "/docs/deployment/docker-swarm": "Ship",
  "/docs/deployment/kubernetes": "Container",
  "/docs/deployment/reverse-proxy": "Globe",
  "/docs/recipes": "Container",
  "/docs/recipes/llama-cpp": "Cpu",
  "/docs/recipes/vllm": "Zap",
  "/docs/recipes/sglang": "Sparkles",
  "/docs/providers": "Cloud",
  "/docs/reference": "BookMarked",
  "/docs/reference/plugins": "Puzzle",
  "/docs/reference/client": "Cable",
  "/docs/reference/cli": "Terminal",
  "/docs/reference/security": "Shield",
  "/docs/plugins": "Puzzle",
  "/docs/plugins/compression": "Shrink",
  "/docs/plugins/cors": "Globe",
  "/docs/plugins/csrf": "ShieldAlert",
  "/docs/plugins/username": "UserRound",
  "/docs/plugins/anonymous": "UserRoundMinus",
  "/docs/plugins/magic-link": "Link2",
  "/docs/plugins/otp": "KeyRound",
  "/docs/plugins/two-factor": "LockKeyhole",
  "/docs/plugins/passkey": "FingerprintPattern",
  "/docs/plugins/ip-allowlist": "ListChecks",
  "/docs/plugins/maintenance-mode": "Construction",
  "/docs/plugins/headers": "ShieldCheck",
  "/docs/plugins/oauth": "FingerprintPattern",
  "/docs/ai": "Bot",
  "/docs/ai/mcp": "Plug",
  "/docs/ai/skills": "Sparkles",
  "/docs/ai/llms-txt": "FileText",
  "/docs/reference/configuration": "Settings",
  "/docs/reference/fx": "Braces",
  "/docs/reference/okid": "Hash",
  "/docs/reference/i18n": "Languages",
  "/docs/reference/environment-variables": "Variable",
  "/docs/reference/errors": "CircleAlert",
};

/** Docs path → monochrome brand mark id. */
const PATH_BRANDS: Readonly<Record<string, BrandMarkId>> = {
  "/docs/recipes/postgres": "postgresql",
  "/docs/recipes/pgdog": "pgdog",
  "/docs/recipes/supabase-docker": "supabase",
  "/docs/recipes/cockroachdb": "cockroachdb",
  "/docs/recipes/yugabytedb": "yugabytedb",
  "/docs/recipes/redis": "redis",
  "/docs/recipes/valkey": "valkey",
  "/docs/recipes/dragonfly": "dragonfly",
  "/docs/recipes/caddy": "caddy",
  "/docs/recipes/traefik": "traefik",
  "/docs/recipes/nginx": "nginx",
  "/docs/recipes/timescale": "timescale",
  "/docs/recipes/rustfs": "rustfs",
  "/docs/recipes/mailpit": "mailpit",
  "/docs/recipes/meilisearch": "meilisearch",
  "/docs/recipes/ollama": "ollama",
  "/docs/providers/neon": "neon",
  "/docs/providers/supabase": "supabase",
  "/docs/providers/cockroachdb": "cockroachdb",
  "/docs/providers/yugabytedb": "yugabytedb",
  "/docs/providers/redis-cloud": "redis",
  "/docs/providers/elasticache": "aws",
  "/docs/providers/memorystore": "googlecloud",
  "/docs/providers/azure-redis": "azure",
  "/docs/providers/upstash": "upstash",
  "/docs/providers/dragonfly-cloud": "dragonfly",
  "/docs/providers/digitalocean-caching": "digitalocean",
  "/docs/plugins/apple": "apple",
  "/docs/plugins/discord": "discord",
  "/docs/plugins/facebook": "facebook",
  "/docs/plugins/figma": "figma",
  "/docs/plugins/github": "github",
  "/docs/plugins/google": "google",
  "/docs/plugins/microsoft": "microsoft",
  "/docs/plugins/x": "x",
};

/** Folder display name → docs path for icon lookup. */
const FOLDER_PATHS: Readonly<Record<string, string>> = {
  Documentation: "/docs",
  Concepts: "/docs/concepts",
  Understand: "/docs/understand",
  "Get Started": "/docs/get-started",
  Elements: "/docs/elements",
  Flow: "/docs/elements/flow",
  Signal: "/docs/elements/signal",
  Store: "/docs/elements/store",
  Clock: "/docs/elements/clock",
  Gate: "/docs/elements/gate",
  Vault: "/docs/elements/vault",
  Channel: "/docs/elements/channel",
  AI: "/docs/elements/ai",
  Deployment: "/docs/deployment",
  Recipes: "/docs/recipes",
  Providers: "/docs/providers",
  Reference: "/docs/reference",
  Plugins: "/docs/plugins",
  "AI Resources": "/docs/ai",
};

/**
 * Resolve a sidebar icon for a docs path — brand mark first, then Lucide.
 *
 * @param path - Absolute docs URL path
 */
function iconForPath(path: string | undefined): ReactNode {
  if (!path) return undefined;

  const brandId = PATH_BRANDS[path];
  if (brandId) {
    const Mark = BRAND_MARKS[brandId];
    return createElement(Mark, { className: "size-4 shrink-0" });
  }

  const name = PATH_ICONS[path];
  if (!name) return undefined;
  const Icon = icons[name] as LucideIcon | undefined;
  if (!Icon) return undefined;
  return createElement(Icon, { className: "size-4" });
}

/**
 * Loader plugin that attaches Lucide / brand icons to the page tree
 * (folder + page). Frontmatter icons alone are not always wired into the tree
 * in Fumadocs MDX; this mirrors better-auth's explicit sidebar icon map.
 */
export function sidebarIconsPlugin(): LoaderPlugin {
  return {
    name: "oke:sidebar-icons",
    transformPageTree: {
      file(node) {
        if (node.url) {
          const icon = iconForPath(node.url);
          if (icon) node.icon = icon;
        }
        return node;
      },
      folder(node) {
        const name = typeof node.name === "string" ? node.name : undefined;
        const path = name ? FOLDER_PATHS[name] : undefined;
        const icon = iconForPath(path);
        if (icon) node.icon = icon;
        return node;
      },
    },
  };
}
