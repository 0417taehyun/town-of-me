import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', 'BACKEND_')
  return {
    plugins: [react()],
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
