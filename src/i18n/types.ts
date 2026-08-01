/**
 * Type-level helpers for message catalogs — keys, shapes, Register slot.
 */

/** Nested or flat message tree (leaf values are ICU message strings). */
export type MessageTree = {
  readonly [key: string]: string | MessageTree;
};

/**
 * Flatten a message tree into dot-separated key unions.
 *
 * @typeParam T - Message tree
 * @typeParam Prefix - Accumulated path prefix
 */
export type FlattenKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? Prefix extends ""
      ? K
      : `${Prefix}.${K}`
    : T[K] extends MessageTree
      ? FlattenKeys<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>
      : never;
}[keyof T & string];

/**
 * Same key structure as {@link Base}; every leaf is an ICU message string.
 * Use with `satisfies` so Arabic (etc.) cannot drift from English keys.
 *
 * @typeParam Base - Canonical (usually English) tree
 */
export type MessagesFor<Base extends MessageTree> = {
  [K in keyof Base]: Base[K] extends string
    ? string
    : Base[K] extends MessageTree
      ? MessagesFor<Base[K]>
      : never;
};

/**
 * Module-augmentation slot for typed `fx.t` keys.
 *
 * @example
 * ```ts
 * const en = { greeting: "Hello, {name}" } as const;
 * defineLocale("en", en);
 *
 * declare module "okengine" {
 *   interface Register {
 *     messages: typeof en;
 *   }
 * }
 * ```
 */
export interface Register {
  // intentionally empty — augmented by the app
}

/** Messages from {@link Register}, when the app augments them. */
type MessagesFromRegister = Register extends { readonly messages: infer M }
  ? M extends MessageTree
    ? M
    : never
  : never;

/**
 * Autocomplete / compile-time keys for {@link Fx.t}.
 * Falls back to `string` until the app augments {@link Register}.
 */
export type AppMessageKey = [MessagesFromRegister] extends [never]
  ? string
  : FlattenKeys<MessagesFromRegister>;

/**
 * Values passed to ICU messages — primitives plus rich-text tag functions.
 *
 * Tag functions receive the formatted chunks inside `<tag>…</tag>` and return
 * a string (or stringable) replacement.
 */
export type MessageValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | ((chunks: readonly string[]) => string);

/** Named values for one `fx.t` / {@link formatMessage} call. */
export type MessageValues = Readonly<Record<string, MessageValue>>;
