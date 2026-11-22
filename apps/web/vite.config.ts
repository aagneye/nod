import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev only: serve /api/* from server/api.ts (the same dispatcher the Vercel functions and the
 * standalone server run). Loaded through ssrLoadModule so edits reload without restarting;
 * the HSP session and mock state live on globalThis and survive reloads.
 */
function nodApi(): Plugin {
  return {
    name: 'nod-api',
    apply: 'serve',
    config(_config, { mode }) {
      // Make server settings from .env files visible to the handlers (they read process.env).
      const envDir = fileURLToPath(new URL('.', import.meta.url));
      const env = loadEnv(mode, envDir, ['NOD_', 'VITE_', 'HSP_', 'HSK_', 'SEPOLIA_']);
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
    },
    configureServer(server) {
      const load = async () => {
        const api = (await server.ssrLoadModule('/server/api.ts')) as typeof import('./server/api');
        const adapter = (await server.ssrLoadModule('/server/node-adapter.ts')) as typeof import('./server/node-adapter');
        return { api, adapter };
      };
      // Connect to HSP once at startup so the live tool list and schemas are logged (live mode).
      server.httpServer?.once('listening', () => {
        load()
          .then(({ api }) => api.warmUpHsp())
          .catch((e: unknown) => server.config.logger.warn(`[nod] could not load the API: ${String(e)}`));
      });
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (path !== '/api' && !path.startsWith('/api/')) return next();
        try {
          const { api, adapter } = await load();
          await adapter.toNodeHandler(api.handleApiRequest)(req, res);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

/**
 * X and Telegram only show the preview card for an absolute og:image URL.
 * At build time, prefix it with NOD_PUBLIC_URL, or Vercel's production domain.
 */
function absoluteSocialImage(): Plugin {
  return {
    name: 'nod-social-image',
    apply: 'build',
    transformIndexHtml(html) {
      const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
      const origin = (process.env.NOD_PUBLIC_URL || (vercel ? `https://${vercel}` : '')).replace(/\/+$/, '');
      if (!origin) return html;
      return html.replace(/content="\/og\.png"/g, `content="${origin}/og.png"`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), nodApi(), absoluteSocialImage()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
