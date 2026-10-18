import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const target = env.FLOWSENSE_API_URL || env.VITE_API_URL || `http://127.0.0.1:${env.FLOWSENSE_API_PORT || '8002'}`
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3001,
      strictPort: true,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
        '/ws': {
          target,
          ws: true,
        },
      },
    },
  }
})
