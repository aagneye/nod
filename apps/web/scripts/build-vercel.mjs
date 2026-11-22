/**
 * Write the Vercel Build Output API v3 folder (.vercel/output) after `vite build`:
 *   config.json                          routes: filesystem first, then SPA fallback to index.html
 *   static/                              copy of dist/
 *   functions/api/<route>.func/          one Node function per /api route (same bundle of
 *                                        server/vercel.ts in each; it dispatches by path)
 * Every dependency (including the raw-TypeScript @nod/protocol workspace package) is inlined,
 * so nothing resolves from node_modules at runtime.
 *
 * HSP only accepts allowlisted IPs and Vercel functions have no fixed IP, so on Vercel the HSP
 * routes (/api/pay/*, /api/vendor/buy, and the HSP probe in /api/config) answer 503
 * hsp_unavailable. Two ways around it, both pointing at the standalone server
 * (`npm run serve -w @nod/web`) on an allowlisted machine:
 *   - NOD_API_PROXY=https://api.example.com at build time: no functions are built and Vercel
 *     proxies every /api request to that origin (same-origin for the browser, no CORS).
 *   - VITE_API_BASE=https://api.example.com at build time: the browser calls that origin directly.
 *
 * Run: npm run build:vercel (from apps/web).
 */
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleServer } from './bundle-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, '.vercel', 'output');

/** The /api paths, read from the route table in server/api.ts so the two never drift. */
async function apiPaths() {
  const source = await readFile(join(root, 'server', 'api.ts'), 'utf8');
  const table = source.slice(source.indexOf('export const ROUTES'));
  const paths = [...table.matchAll(/'(\/api\/[a-z0-9/-]+)':\s*\{\s*method/g)].map((m) => m[1]);
  if (paths.length === 0) throw new Error('No routes found in server/api.ts');
  return paths;
}

function proxyOrigin() {
  const raw = (process.env.NOD_API_PROXY ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`NOD_API_PROXY must be an http(s) origin, got ${raw}`);
  return url.origin;
}

async function main() {
  try {
    await stat(join(dist, 'index.html'));
  } catch {
    throw new Error('dist/index.html is missing; run `vite build` first (npm run build:vercel does both).');
  }

  const proxy = proxyOrigin();
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await writeFile(
    join(out, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
          ...(proxy ? [{ src: '^/api/(.*)$', dest: `${proxy}/api/$1` }] : []),
          { handle: 'filesystem' },
          { src: '^/api/(.*)$', status: 404 },
          { src: '^/(.*)$', dest: '/index.html' },
        ],
      },
      null,
      2,
    ),
  );

  await cp(dist, join(out, 'static'), { recursive: true });

  if (proxy) {
    console.log(`/api/* proxies to ${proxy}/api/* (NOD_API_PROXY); no functions built`);
    console.log(`Wrote ${out}`);
    return;
  }

  const bundle = join(out, '.bundle', 'index.mjs');
  await bundleServer({ root, input: join(root, 'server', 'vercel.ts'), file: bundle });
  const size = (await stat(bundle)).size;
  const paths = await apiPaths();
  for (const path of paths) {
    const funcDir = join(out, 'functions', `${path.slice(1)}.func`);
    await mkdir(funcDir, { recursive: true });
    await copyFile(bundle, join(funcDir, 'index.mjs'));
    await writeFile(
      join(funcDir, '.vc-config.json'),
      JSON.stringify(
        { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 },
        null,
        2,
      ),
    );
  }
  await rm(join(out, '.bundle'), { recursive: true, force: true });
  console.log(`functions: ${paths.join(', ')} (index.mjs ${(size / 1024).toFixed(0)} kB each)`);
  console.log('note: HSP routes answer 503 hsp_unavailable on Vercel (no fixed IP for the HSP allowlist); see the header of this script');
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
