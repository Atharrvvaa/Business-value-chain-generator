import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      // Proxy /api/* → FastAPI backend (no CORS issues in dev)
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        proxyTimeout: 360000,
        timeout: 360000,
      },
    },
  },
})
