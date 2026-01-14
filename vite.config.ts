import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // allow the app to be served from a subdirectory (as is custom on GitHub pages)
  base: "./",
  plugins: [react()],
})
