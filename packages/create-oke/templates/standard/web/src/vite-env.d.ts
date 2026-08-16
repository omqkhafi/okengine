interface ViteTypeOptions {
  // By adding this line, you can make the type of ImportMetaEnv strict
  // to disallow unknown keys.
  // strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  /**
   * App origin for `createClient`. Unset / empty = same origin so Vite's
   * `server.proxy` forwards `/notes` · `/health` · `/_oke` to `oke dev`.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
