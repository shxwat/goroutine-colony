import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // three.js is the bulk of the bundle; one chunk is fine for a single-page experiment
  build: { chunkSizeWarningLimit: 1600 },
})
