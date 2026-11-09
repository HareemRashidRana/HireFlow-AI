/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Where the dev server forwards /api calls. Override with API_PROXY_TARGET to point at another backend.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward /api calls to the FastAPI backend during development (avoids CORS issues and keeps
    // the refresh cookie same-origin).
    proxy: {
      '/api': apiTarget,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
