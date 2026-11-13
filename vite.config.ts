import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works from any static host or sub-path (e.g. GitHub Pages)
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
})
