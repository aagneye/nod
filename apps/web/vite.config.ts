import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev only: serve /api/* from server/ (the same handlers Vercel runs, see scripts/build-vercel.mjs).
 * Handlers are loaded through ssrLoadModule so edits reload without restarting.
 */
function nodApi(): Plugin {
  return {
    name: 'nod-api',
    apply: 'serve',
    config(_config, { mode }) {
      // Make NOD_* / VITE_* from .env files visible to the handlers (they read process.env).
      const env = loadEnv(mode, process.cwd(), ['NOD_', 'VITE_']);
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (!path.startsWith('/api/')) return next();
        try {
          const { routes } = (await server.ssrLoadModule('/server/routes.ts')) as typeof import('./server/routes');
          const { toNodeHandler } = (await server.ssrLoadModule('/server/node-adapter.ts')) as typeof import('./server/node-adapter');
          const handler = routes[path.replace(/\/+$/, '')];
          if (!handler) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: `No API route ${path}` }));
            return;
          }
          await toNodeHandler(handler)(req, res);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), nodApi()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
