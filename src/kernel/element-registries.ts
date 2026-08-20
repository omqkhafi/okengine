/**
 * Module-evaluation registries for `store.*`, `vault.secret`,
 * `vault.env.required`, `signal()`, `clock()`, `gate.policy` / `.scope` /
 * `.rate`, `channel.<medium>().template()`, and `ai.model` / `.prompt` /
 * `ai.embed` / `ai.agent` / `ai.mcpServer` — the plain arrays behind each
 * declare module's `listX()` / `resetX()` pair (mirrors `on.ts`'s
 * trigger-drain `bindings` array).
 *
 * Lives here, not in the declare modules themselves, so {@link oke} can read
 * every registry with one lightweight import instead of statically pulling
 * in all element `declare.ts` modules (and every unrelated export they
 * carry) into every app's bundle — see the `oke()` Store-only bundle-size
 * budget in `boot.test.ts`. Only type imports cross back to the declare
 * modules, so this file has zero runtime dependencies of its own.
 */

import type {
  AiAgentDecl,
  AiEmbedDecl,
  AiMcpServerDecl,
  AiModelDecl,
  AiPromptDecl,
} from "../elements/ai/declare.ts";
import type { StoreDecl } from "../elements/store/declare.ts";
import type { VaultSecretDecl } from "../elements/vault/declare.ts";
import type { SignalDecl } from "../elements/signal/declare.ts";
import type { ChannelTemplateDecl } from "../elements/channel/declare.ts";
import type { ClockDecl } from "../elements/clock/declare.ts";
import type { GateDecl } from "../elements/gate/declare.ts";

/** `store.sql` / `store.kv` / `store.files` / `store.index` declarations since the last reset. */
export const storeRegistry: StoreDecl[] = [];
/** `vault.secret` declarations since the last reset. */
export const secretRegistry: VaultSecretDecl[] = [];
/** `vault.env.required(name)` environment variables since the last reset. */
export const requiredEnvRegistry: string[] = [];
/** `signal()` declarations since the last reset. */
export const signalRegistry: SignalDecl[] = [];
/** `clock()` declarations since the last reset. */
export const clockRegistry: ClockDecl[] = [];
/** `gate.policy` / `gate.scope` / `gate.rate` declarations since the last reset. */
export const gateRegistry: GateDecl[] = [];
/** Medium-binder `.template()` declarations since the last reset. */
export const channelTemplateRegistry: ChannelTemplateDecl[] = [];
/** `ai.model` declarations since the last reset. */
export const aiModelRegistry: AiModelDecl[] = [];
/** `model.prompt` declarations since the last reset. */
export const aiPromptRegistry: AiPromptDecl[] = [];
/** `ai.embed` declarations since the last reset. */
export const aiEmbedRegistry: AiEmbedDecl[] = [];
/** `ai.agent` declarations since the last reset. */
export const aiAgentRegistry: AiAgentDecl[] = [];
/** `ai.mcpServer` declarations since the last reset. */
export const aiMcpServerRegistry: AiMcpServerDecl[] = [];
