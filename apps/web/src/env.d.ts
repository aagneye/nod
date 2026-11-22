/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin serving /api when it is not the app's own origin (e.g. the fixed-IP server that talks to HSP). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
