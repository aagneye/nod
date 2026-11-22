/**
 * Standalone Nod server for a machine with a fixed public IP. HSP only accepts calls from
 * allowlisted IPs, so the HSP routes have to run somewhere with an address the HSP team knows.
 * Serves the built web app (dist/, with SPA fallback) and every /api route on one port.
 *
 *   npm run serve -w @nod/web                      build dist/ if missing, bundle, start on PORT
 *   npm run serve -w @nod/web -- --rebuild         rebuild dist/ first
 *   docker build -f apps/web/Dockerfile -t nod .   (from the repo root; see the Dockerfile)
 *
 * Env: PORT (default 8787), HOST (default 0.0.0.0), NOD_STATIC_DIR (default: dist/ beside the
 * bundle), plus everything in apps/web/.env.example. `.env.local` and `.env` in the working
 * directory fill in variables that are not already set.
 *
 * The web app can also stay on Vercel: build it with VITE_API_BASE=<this server's origin>
 * (CORS is open by default, NOD_CORS_ORIGIN narrows it), or build the Vercel output with
 * NOD_API_PROXY=<this server's origin> so Vercel proxies /api here.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { handleApiRequest, warmUpHsp } from './api.js';
import { ConfigError, merchantNameFor, readConfig } from './config.js';
import { toNodeHandler } from './node-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFiles(dir: string): string[] {
  const loaded: string[] = [];
  // .env.local wins over .env; real environment variables win over both.
  for (const name of ['.env.local', '.env']) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    const values = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

function findStaticDir(): string | null {
  const explicit = process.env.NOD_STATIC_DIR?.trim();
  if (explicit) return resolve(explicit);
  for (const candidate of [resolve(here, '..', 'dist'), resolve(here, 'dist'), resolve(process.cwd(), 'dist')]) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

/** Static files from `root`; unknown paths without an extension get index.html (SPA routes). */
async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (pathname.includes('\0')) return sendText(res, 400, 'Bad request');
  const target = resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(root + sep)) return sendText(res, 404, 'Not found');

  let file = target;
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  let fallback = false;
  if (!info?.isFile()) {
    if (extname(pathname) !== '') return sendText(res, 404, 'Not found');
    file = join(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) return sendText(res, 404, 'Not found');
    fallback = true;
  }
  const immutable = !fallback && pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise<void>((done, fail) => {
    createReadStream(file).on('error', fail).on('end', done).pipe(res);
  });
}

function main(): void {
  const envFiles = [...new Set([process.cwd(), resolve(here, '..')])].flatMap(loadEnvFiles);

  let summary: string[];
  try {
    const cfg = readConfig();
    const merchant = merchantNameFor(cfg, cfg.hsp.mode);
    summary = [
      cfg.hsp.mode === 'mock'
        ? 'HSP: MOCK (payments are simulated in memory; set HSP_MODE=live for real payments)'
        : `HSP: live at ${cfg.hsp.url} (this machine's public IP must be allowlisted by HSP)`,
      `merchant name: ${merchant ?? 'NOT SET (NOD_MERCHANT_NAME is required for payments)'}`,
      `receipts: chain ${cfg.receipts.chainId}, contract ${cfg.receipts.address ?? 'not set'}, recorder ${cfg.receipts.recorder ?? 'not set'}${cfg.receipts.recorderKey ? '' : ' (no key: anchoring off)'}`,
    ];
  } catch (error) {
    console.error(`[nod] ${error instanceof ConfigError ? error.message : String(error)}`);
    process.exit(1);
  }

  const staticDir = findStaticDir();
  const api = toNodeHandler(handleApiRequest);
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/api' || path.startsWith('/api/')) {
      const started = Date.now();
      res.on('finish', () => console.log(`[nod] ${req.method} ${path} ${res.statusCode} ${Date.now() - started} ms`));
      void api(req, res);
      return;
    }
    if (!staticDir) {
      sendText(res, 404, 'No web app build found: run `npm run build -w @nod/web` or set NOD_STATIC_DIR. The API is under /api.');
      return;
    }
    serveStatic(req, res, staticDir).catch((error: unknown) => {
      console.error(`[nod] static ${path}: ${String(error)}`);
      if (!res.headersSent) sendText(res, 500, 'Internal error');
      else res.destroy();
    });
  });

  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  server.on('error', (error) => {
    console.error(`[nod] server error: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const lines = [
      `[nod] standalone server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (listening on ${host})`,
      ...summary.map((line) => `[nod] ${line}`),
      `[nod] web app: ${staticDir ?? 'none (API only)'}`,
      ...(envFiles.length > 0 ? [`[nod] env files: ${envFiles.join(', ')}`] : []),
    ];
    console.log(lines.join('\n'));
    void warmUpHsp();
  });

  const shutdown = (signal: string) => {
    console.log(`[nod] ${signal}: shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
