/// <reference types="vite/client" />

/** Injected from root package.json by Vite `define`. */
declare const __OKE_VERSION__: string;

/**
 * Fixed Console operator for login prefill on standalone `dev:console`
 * / `:seed` only — null for `oke dev` HMR and production builds.
 * Injected by Vite `define` from `ui-next-dev-operator.ts`.
 */
declare const __OKE_DEV_OPERATOR__: { readonly email: string; readonly password: string } | null;

/**
 * True when Vite serve is `dev:console:seed` (`OKE_CONSOLE_SEEDED=1`).
 * Production `oke dev` / `oke start` dist is always false.
 */
declare const __OKE_CONSOLE_SEEDED__: boolean;
