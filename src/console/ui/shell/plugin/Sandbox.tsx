/**
 * Plugin panel host — sandboxed iframe without `allow-same-origin`.
 *
 * Communicates only over `postMessage` (console §10.4).
 */

import { PLUGIN_IFRAME_SANDBOX } from "../../../server/security-headers.ts";

/** Props for {@link PluginSandbox}. */
export interface PluginSandboxProps {
  readonly panelId: string;
  readonly title: string;
}

/**
 * Embed a plugin panel in a sandboxed iframe.
 *
 * @param props - Panel id + title
 */
export function PluginSandbox({ panelId, title }: PluginSandboxProps) {
  return (
    <iframe
      title={title}
      src={`/plugin-frame/${encodeURIComponent(panelId)}`}
      sandbox={PLUGIN_IFRAME_SANDBOX}
      className="h-64 w-full border border-[var(--oke-line)] bg-black/20"
    />
  );
}
