// Bundles the CLI and MCP server into dist/cli.mjs and dist/mcp.mjs with rolldown
// (a dependency of Vite, already installed). @nod/protocol ships TypeScript, so it is
// inlined; its npm dependencies stay external and resolve from the repo's node_modules.
import { chmodSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

// Every bare import except @nod/* stays external.
const isExternal = (id) => !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('@nod/');

for (const name of ['cli', 'mcp']) {
  await build({
    input: join(root, 'src', 'bin', `${name}.ts`),
    platform: 'node',
    external: isExternal,
    resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
    logLevel: 'warn',
    output: {
      file: join(dist, `${name}.mjs`),
      format: 'esm',
      banner: '#!/usr/bin/env node',
      codeSplitting: false,
    },
  });
  try {
    chmodSync(join(dist, `${name}.mjs`), 0o755);
  } catch {
    /* Windows */
  }
  console.log(`built dist/${name}.mjs`);
}
