/// <reference types="vite/client" />

/** Injected from root package.json by Vite `define`. */
declare const __OKE_VERSION__: string;

/**
 * Fixed console-next operator for login prefill (serve + not fresh), or null.
 * Injected by Vite `define` from `ui-next-dev-operator.ts`.
 */
declare const __OKE_DEV_OPERATOR__: { readonly email: string; readonly password: string } | null;
