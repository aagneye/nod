/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_SLIDES_URL?: string;
  readonly VITE_EMBER2026_ADDRESS?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
