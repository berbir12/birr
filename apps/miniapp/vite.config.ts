import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Tunnelled dev (cloudflared) arrives with a foreign Host header.
    allowedHosts: true,
    proxy: { '/api': 'http://127.0.0.1:8787', '/ingest': 'http://127.0.0.1:8787' },
  },
});
