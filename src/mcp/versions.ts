/**
 * MCP protocol versions.
 *
 * The app and docs servers implement `initialize`, `ping`, `tools/list`, and
 * `tools/call`. That is the 2024-11-05 tools surface, so they advertise
 * {@link MCP_PROTOCOL_VERSION} and reject any other client version.
 *
 * The outbound client is separate. It probes external servers with
 * {@link MCP_CLIENT_PROTOCOL_VERSION} (`_meta` on each request) and falls
 * back to a 2024-11-05 `initialize`. That constant is not the server
 * advertisement.
 */

/** Versions the app and docs servers implement, newest last. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05"] as const;

/** Highest protocol version the servers implement and advertise. */
export const MCP_PROTOCOL_VERSION: (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number] = "2024-11-05";

/** Version the outbound MCP client probes first. Not the server advertisement. */
export const MCP_CLIENT_PROTOCOL_VERSION = "2026-07-28";

/** `initialize` dialect the outbound client falls back to. */
export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";

const ACCEPTED: readonly string[] = MCP_SUPPORTED_PROTOCOL_VERSIONS;

/**
 * Whether a client-offered protocol version is one this server implements.
 *
 * @param version - `initialize` or `tools/call` protocol version
 */
export function acceptsMcpProtocolVersion(version: string): boolean {
  return ACCEPTED.includes(version);
}

/**
 * Pick the protocol version for an `initialize` result.
 *
 * An omitted client version gets the highest version this server implements.
 * A supported client version is echoed. Anything else has no overlap.
 *
 * @param requested - Client `protocolVersion`, when present
 */
export function negotiateMcpProtocolVersion(requested: string | undefined): string | undefined {
  if (requested === undefined) return MCP_PROTOCOL_VERSION;
  if (acceptsMcpProtocolVersion(requested)) return requested;
  return undefined;
}

/**
 * Read `params.protocolVersion` when the client sent one.
 *
 * @param params - JSON-RPC params
 */
export function protocolVersionOf(params: unknown): string | undefined {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return undefined;
  const version = (params as { protocolVersion?: unknown }).protocolVersion;
  return typeof version === "string" && version.length > 0 ? version : undefined;
}
