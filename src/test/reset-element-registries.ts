/**
 * Global safety net for the `store.sql` / `store.files` / `vault.secret` /
 * `signal()` / `channel.<medium>().template()` / `ai.model`·prompt·embed·agent
 * auto-registries (`src/kernel/element-registries.ts`).
 *
 * Unlike `on()` bindings — created almost exclusively to wire a real app —
 * these factories are called throughout the suite as bare value constructors,
 * completely unrelated to booting an app (hundreds of call sites across
 * `src/elements/*.test.ts`). Since the registries are plain module-level
 * arrays shared by every test file in one `bun test` process, leaving cleanup
 * to per-file discipline (the convention `on.ts` relies on — see
 * `resetBindings()` / `registry: "ignore"`) would let stray decls from one
 * file silently reach a default-registry `oke()` call in a completely
 * unrelated file. Reset after every test, globally, via `bunfig.toml`
 * `[test].preload`.
 */

import { afterEach } from "bun:test";
import {
  aiAgentRegistry,
  aiEmbedRegistry,
  aiMcpServerRegistry,
  aiModelRegistry,
  aiPromptRegistry,
  channelTemplateRegistry,
  requiredEnvRegistry,
  secretRegistry,
  signalRegistry,
  storeRegistry,
} from "../kernel/element-registries.ts";

afterEach(() => {
  storeRegistry.length = 0;
  secretRegistry.length = 0;
  requiredEnvRegistry.length = 0;
  signalRegistry.length = 0;
  channelTemplateRegistry.length = 0;
  aiModelRegistry.length = 0;
  aiPromptRegistry.length = 0;
  aiEmbedRegistry.length = 0;
  aiAgentRegistry.length = 0;
  aiMcpServerRegistry.length = 0;
});
