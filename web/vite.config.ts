import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Read the version straight from package.json so the footer badge can never drift
// from the real release. Inlined at build time via `define` below.
const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Compile-time constant; typed in src/env.d.ts. JSON.stringify so it inlines as a
  // string literal, not a bare identifier.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
