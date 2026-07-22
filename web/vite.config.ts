import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
