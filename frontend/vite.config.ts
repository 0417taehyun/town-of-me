import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sharePreviewTags } from './sharePreview.ts'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', ['BACKEND_', 'SITE_'])
  const sharePreview = sharePreviewTags({
    origin: environment.SITE_ORIGIN,
    title: environment.SITE_TITLE,
    description: environment.SITE_DESCRIPTION,
  })
  return {
    plugins: [
      react(),
      { name: 'share-preview', transformIndexHtml: (html) => html.replace('<!-- share-preview -->', sharePreview) },
    ],
    server: {
      proxy: {
        '/v1': {
          target: environment.BACKEND_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
})
