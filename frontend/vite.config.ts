import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  server: {
    // the DBMS viewer tab imports ../database/schema.sql directly
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
    },
  },
})
