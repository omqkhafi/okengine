/**
 * Lazy channel binder — loaded only when Channel is declared.
 */

import { openConsoleChannel } from "../../drivers/channel-console.ts";
import { createChannelRuntime, type ChannelRuntime } from "../../elements/channel.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct a Channel runtime (console inbox default).
 *
 * @param options - Boot options
 * @param now - Clock
 */
export function bindChannel(options: BootOptions, now: () => number): ChannelRuntime {
  return createChannelRuntime({
    ...(options.channel ?? {}),
    drivers: options.channel?.drivers ?? [openConsoleChannel()],
    now,
  });
}
