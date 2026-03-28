import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // 👈 이거 추가!

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // 👈 이것도 추가!
  ],
})