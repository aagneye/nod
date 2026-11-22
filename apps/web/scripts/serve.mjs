/**
 * Run the standalone server (server/standalone.ts): the web app and every /api route on one
 * port, for a machine whose public IP HSP has allowlisted.
 *
 *   npm run serve -w @nod/web                    build dist/ if missing, bundle the server, start it
 *   npm run serve -w @nod/web -- --rebuild       rebuild dist/ first
 *   npm run build:standalone -w @nod/web         build dist/ and .server/standalone.mjs, do not start
 *
 * The bundle (.server/standalone.mjs) is self-contained: `node .server/standalone.mjs` runs it
 * with only dist/ beside it (that is what the Dockerfile does).
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleServer } from './bundle-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const buildOnly = args.has('--build-only');
const rebuildClient = buildOnly || args.has('--rebuild');

if (rebuildClient || !existsSync(join(root, 'dist', 'index.html'))) {
  console.log('[nod] building the web app (vite build) ...');
  const { build } = await import('vite');
  await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
}

const out = join(root, '.server', 'standalone.mjs');
const started = Date.now();
await bundleServer({ root, input: join(root, 'server', 'standalone.ts'), file: out });
console.log(`[nod] bundled ${out} (${(statSync(out).size / 1024).toFixed(0)} kB, ${Date.now() - started} ms)`);

if (!buildOnly) await import(pathToFileURL(out).href);
