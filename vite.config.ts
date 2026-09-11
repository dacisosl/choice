import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: https://dacisosl.github.io/choice/
export default defineConfig({
  plugins: [react()],
  base: '/choice/',
})
