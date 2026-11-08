/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare Web Analytics site token, read at build time; without it no beacon loads. */
  readonly VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN?: string
}
