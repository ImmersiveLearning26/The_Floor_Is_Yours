import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Two pages: the learner simulation (index.html) and the facilitator review page (facilitator.html).
// On Lovable the API is the Lovable Cloud function; locally `npm run dev` proxies /api to the dev server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '::',
    port: 8080,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2020', sourcemap: false,
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), facilitator: fileURLToPath(new URL('./facilitator.html', import.meta.url)) } },
  },
});
