/// <reference types="vite/client" />

// The VITE_-prefixed env the config module reads as its Vite dev fallback (config.ts).
// Declared so import.meta.env access typechecks without an ambient index signature.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_GUESTS_ENABLED?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
