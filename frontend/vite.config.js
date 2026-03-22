import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/test-integration': {
        target: 'https://hueiq-main-site-1.purplesand-63becfba.westus2.azurecontainerapps.io',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
