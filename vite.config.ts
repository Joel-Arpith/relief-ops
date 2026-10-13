import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the UI; /api is proxied to `wrangler pages dev` (port 8788) for the backend.
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8788' } },
});
