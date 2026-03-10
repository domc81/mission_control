import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Dev: proxy /ws → OpenClaw gateway (loopback only, not accessible from browser directly)
      '/ws': {
        target: 'ws://127.0.0.1:18789',
        ws: true,
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/ws/, ''),
      },
      // Dev: proxy /api/costs → proxy-server (cost API)
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
