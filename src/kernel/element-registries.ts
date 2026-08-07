/**
 * Module-evaluation registries for `store.sql` / `store.files`, `vault.secret`,
 * `signal()`, and `channel.<medium>().template()` — the plain arrays behind
 * each declare module's `listX()` / `resetX()` pair (mirrors `on.ts`'s
 * trigger-drain `bindings` array).
 *
 * Lives here, not in the declare modules themselves, so {@link oke} can read
 * every registry with one lightweight import instead of statically pulling
 * in all four element `declare.ts` modules (and every unrelated export they
 * carry) into every app's bundle — see the `oke()` Store-only bundle-size
 * budget in `boot.test.ts`. Only type imports cross back to the declare
 * modules, so this file has zero runtime dependencies of its own.
 */

import type { StoreDecl } from "../elements/store/declare.ts";
import type { VaultSecretDecl } from "../elements/vault/declare.ts";
import type { SignalDecl } from "../elements/signal/declare.ts";
import type { ChannelTemplateDecl } from "../elements/channel/declare.ts";

/** `store.sql` / `store.files` declarations since the last reset. */
export const storeRegistry: StoreDecl[] = [];
/** `vault.secret` declarations since the last reset. */
export const secretRegistry: VaultSecretDecl[] = [];
/** `signal()` declarations since the last reset. */
export const signalRegistry: SignalDecl[] = [];
/** Medium-binder `.template()` declarations since the last reset. */
export const channelTemplateRegistry: ChannelTemplateDecl[] = [];
