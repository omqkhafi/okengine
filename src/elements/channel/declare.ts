/**
 * Channel declaration — templates with i18n, medium helpers.
 *
 * Physics: email · SMS · WhatsApp · push.
 */

import type { ChannelMedium } from "../../manifest/types.ts";

/** Options for a medium binder (`channel.email`, …). */
export interface ChannelMediumOptions {
  readonly from?: string;
  readonly sender?: string;
}

/** Options for {@link channel.template} / medium `.template`. */
export interface ChannelTemplateOptions {
  readonly medium?: ChannelMedium;
  readonly locales?: string[];
  readonly schema?: unknown;
  readonly from?: string;
}

/** Declared channel template handle. */
export interface ChannelTemplateDecl {
  readonly kind: "template";
  readonly name: string;
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
      return {
        kind: "template",
        name,
        medium,
        ...(opts.locales ? { locales: opts.locales } : {}),
        ...(opts.schema !== undefined ? { schema: opts.schema } : {}),
        ...(from !== undefined ? { from } : {}),
      };
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
