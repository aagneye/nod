import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Vercel functions (api/) run alongside the app in production; in dev the
    // demo-agent endpoint is optional — Home shows its absence honestly.
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
