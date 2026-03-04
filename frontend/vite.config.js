import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Tailwind v4 integrates directly as a Vite plugin — no postcss.config.js needed.
// The plugin handles CSS processing internally, which is faster than the old
// PostCSS pipeline and keeps the config surface area minimal.
//
// The path alias "@" → "./src" is required by shadcn/ui: its generated
// components import each other as "@/components/ui/..." so the alias must
// be resolvable at build time.
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
