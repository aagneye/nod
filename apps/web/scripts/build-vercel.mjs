/**
 * Write the Vercel Build Output API v3 folder (.vercel/output) after `vite build`:
 *   config.json                          routes: filesystem first, then SPA fallback to index.html
 *   static/                              copy of dist/
 *   functions/api/<name>.func/index.mjs  one fully bundled Node function per endpoint
 *   functions/api/<name>.func/.vc-config.json
 * Every dependency (including the raw-TypeScript @nod/protocol workspace package) is inlined,
 * so nothing resolves from node_modules at runtime.
 * Run: npm run build:vercel (from apps/web).
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, '.vercel', 'output');

/** Public path (under /api) → entry file in server/functions. */
const FUNCTIONS = {
  'demo-agent': 'server/functions/demo-agent.ts',
  'vendor/buy': 'server/functions/vendor-buy.ts',
};

// CommonJS dependencies (ws) call require() for Node built-ins; give the ESM bundle a real one.
const BANNER = "import { createRequire as __nodCreateRequire } from 'node:module';\nconst require = __nodCreateRequire(import.meta.url);";

async function main() {
  try {
    await stat(join(dist, 'index.html'));
  } catch {
    throw new Error('dist/index.html is missing; run `vite build` first (npm run build:vercel does both).');
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await writeFile(
    join(out, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
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

  for (const [name, entry] of Object.entries(FUNCTIONS)) {
    const funcDir = join(out, 'functions', 'api', `${name}.func`);
    await mkdir(funcDir, { recursive: true });
    await build({
      input: join(root, entry),
      platform: 'node',
      cwd: root,
      resolve: {
        extensionAlias: { '.js': ['.ts', '.js'] },
        conditionNames: ['node', 'import', 'module', 'default'],
      },
      logLevel: 'warn',
      output: {
        file: join(funcDir, 'index.mjs'),
        format: 'esm',
        codeSplitting: false,
        banner: BANNER,
        minify: false,
      },
    });
    await writeFile(
      join(funcDir, '.vc-config.json'),
      JSON.stringify(
        { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 15 },
        null,
        2,
      ),
    );
    const files = await readdir(funcDir);
    const size = (await stat(join(funcDir, 'index.mjs'))).size;
    console.log(`functions/api/${name}.func: ${files.join(', ')} (index.mjs ${(size / 1024).toFixed(0)} kB)`);
  }
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
