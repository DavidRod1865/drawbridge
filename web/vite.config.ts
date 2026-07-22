import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@` → src so shadcn's generated components resolve `@/lib/utils` and
    // `@/components/ui/*` the same way they do in a stock shadcn project.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxying /api to the backend keeps the browser on a single origin, so the
    // httpOnly session cookie is sent without any CORS or SameSite negotiation.
    // It also makes dev match production, where both are served from one origin.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
