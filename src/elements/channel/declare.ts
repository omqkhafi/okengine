/**
 * Channel declaration — templates with i18n, medium helpers.
 *
 * Physics: email · SMS · WhatsApp · push.
 */

import type { ChannelMedium } from "../../manifest/types.ts";
import { channelTemplateRegistry } from "../../kernel/element-registries.ts";

/** Options for a medium binder (`channel.email`, …). */
export interface ChannelMediumOptions {
  readonly from?: string;
  readonly sender?: string;
}

/** Options for {@link channel.template} / medium `.template`. */
export interface ChannelTemplateOptions {
  /** Optional human description for Console / docs (falls back to the template name). */
  readonly description?: string;
  readonly medium?: ChannelMedium;
  readonly locales?: string[];
  readonly schema?: unknown;
  readonly from?: string;
}

/** Declared channel template handle. */
export interface ChannelTemplateDecl {
  readonly kind: "template";
  readonly name: string;
  readonly description?: string;
  readonly medium: ChannelMedium;
  readonly locales?: string[];
  readonly schema?: unknown;
  readonly from?: string;
}

/** Medium binder that can declare templates. */
export interface ChannelMediumBinder {
  readonly medium: ChannelMedium;
  readonly from?: string;
  /**
   * Declare a template on this medium.
   *
   * @param name - Template id
   * @param options - Schema / locales
   */
  template(
    name: string,
    options?: Omit<ChannelTemplateOptions, "medium" | "from">,
  ): ChannelTemplateDecl;
}

/**
 * Medium binders' `.template()` (email / sms / whatsapp / push) push into
 * the shared {@link channelTemplateRegistry} (`src/kernel/element-registries.ts`)
 * so {@link oke} can auto-populate `channel.templates` with zero explicit
 * array — mirrors the {@link on} trigger-drain registry
 * (`src/kernel/on.ts`). The medium-agnostic `channel.template()` is
 * intentionally not auto-registered (out of scope).
 *
 * Snapshot of every medium-binder template declared since the last reset.
 */
export function listChannelTemplates(): readonly ChannelTemplateDecl[] {
  return channelTemplateRegistry.slice();
}

/**
 * Clear the channel-template registry (tests / fresh app adopt).
 *
 * @internal
 */
export function resetChannelTemplates(): void {
  channelTemplateRegistry.length = 0;
}

/**
 * Create a medium binder.
 *
 * @param medium - Medium id
 * @param options - Default from / sender
 */
function mediumBinder(
  medium: ChannelMedium,
  options: ChannelMediumOptions = {},
): ChannelMediumBinder {
  const from = options.from ?? options.sender;
  return {
    medium,
    ...(from !== undefined ? { from } : {}),
    template(name, opts = {}) {
      const decl: ChannelTemplateDecl = {
        kind: "template",
        name,
        medium,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.locales ? { locales: opts.locales } : {}),
        ...(opts.schema !== undefined ? { schema: opts.schema } : {}),
        ...(from !== undefined ? { from } : {}),
      };
      channelTemplateRegistry.push(decl);
      return decl;
    },
  };
}

/**
 * Shape of the {@link channel} element namespace.
 */
export interface ChannelNamespace {
  /**
   * Medium-agnostic template.
   *
   * @param name - Template id
   * @param options - Medium / locales / schema
   */
  template(name: string, options?: ChannelTemplateOptions): ChannelTemplateDecl;
  /** Email medium binder. */
  email(options?: ChannelMediumOptions): ChannelMediumBinder;
  /** SMS medium binder. */
  sms(options?: ChannelMediumOptions): ChannelMediumBinder;
  /** WhatsApp medium binder. */
  whatsapp(options?: ChannelMediumOptions): ChannelMediumBinder;
  /** Push medium binder. */
  push(options?: ChannelMediumOptions): ChannelMediumBinder;
}

/**
 * Channel element namespace.
 */
export const channel: ChannelNamespace = {
  /**
   * Medium-agnostic template.
   *
   * @param name - Template id
   * @param options - Medium / locales / schema
   */
  template(name: string, options: ChannelTemplateOptions = {}): ChannelTemplateDecl {
    if (!name) throw new TypeError("channel.template: name is required");
    return {
      kind: "template",
      name,
      medium: options.medium ?? "email",
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.locales ? { locales: options.locales } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.from !== undefined ? { from: options.from } : {}),
    };
  },

  /** Email medium binder. */
  email(options?: ChannelMediumOptions): ChannelMediumBinder {
    return mediumBinder("email", options);
  },

  /** SMS medium binder. */
  sms(options?: ChannelMediumOptions): ChannelMediumBinder {
    return mediumBinder("sms", options);
  },

  /** WhatsApp medium binder. */
  whatsapp(options?: ChannelMediumOptions): ChannelMediumBinder {
    return mediumBinder("whatsapp", options);
  },

  /** Push medium binder. */
  push(options?: ChannelMediumOptions): ChannelMediumBinder {
    return mediumBinder("push", options);
  },
};
