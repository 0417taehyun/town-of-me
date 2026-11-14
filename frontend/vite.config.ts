import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { DERBY_SHARE_PAGE, sharePreviewTags } from './sharePreview.ts'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', ['BACKEND_', 'SITE_'])
  const sharePreview = sharePreviewTags({
    origin: environment.SITE_ORIGIN,
    title: environment.SITE_TITLE,
    description: environment.SITE_DESCRIPTION,
  })
  const derbySharePreview = sharePreviewTags({ origin: environment.SITE_ORIGIN }, DERBY_SHARE_PAGE)
  return {
    plugins: [
      react(),
      {
        name: 'share-preview',
        transformIndexHtml: (html) => html.replace('<!-- share-preview -->', sharePreview),
        // Crawlers read only a page's head, so /baseball gets its own page: the built index.html with the derby's
        // preview in place of the town's, and the same scripts and styles (docker/nginx.conf serves it there).
        generateBundle: {
          order: 'post',
          handler(_options, bundle) {
            const index = bundle['index.html']
            if (index?.type !== 'asset') return
            const source = String(index.source).replace(sharePreview, () => derbySharePreview)
            this.emitFile({ type: 'asset', fileName: 'baseball.html', source })
          },
        },
      },
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
