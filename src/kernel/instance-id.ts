/**
 * Process instance identity — one mint per boot, shared by Clock, Journal,
 * and the fleet registry.
 */

/** Prefix for process instance ids minted at boot. */
export const INSTANCE_ID_PREFIX = "inst-";

/**
 * Mint a process instance id (`inst-<uuid>`).
 */
export function mintInstanceId(): string {
  return `${INSTANCE_ID_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Resolve the process instance id: caller-supplied or a fresh mint.
 *
 * @param instanceId - Optional explicit id
 */
export function resolveInstanceId(instanceId?: string): string {
  return instanceId ?? mintInstanceId();
}
