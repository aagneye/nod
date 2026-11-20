import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Until `npm install` links this workspace, fall back to the protocol sources directly.
const linked = existsSync(fileURLToPath(new URL('../../node_modules/@nod/protocol', import.meta.url)));

export default defineConfig({
  resolve: linked
    ? {}
    : { alias: { '@nod/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
