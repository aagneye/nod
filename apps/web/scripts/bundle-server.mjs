/**
 * Bundle a server entry (TypeScript) into one self-contained ESM file with rolldown (a Vite
 * dependency, already installed). Every dependency is inlined, including the raw-TypeScript
 * @nod/protocol workspace package, so nothing resolves from node_modules at runtime.
 * Used by scripts/build-vercel.mjs and scripts/serve.mjs.
 */
import { build } from 'rolldown';

// CommonJS dependencies (ajv in the MCP SDK) call require() for Node built-ins; give the ESM bundle one.
const BANNER = "import { createRequire as __nodCreateRequire } from 'node:module';\nconst require = __nodCreateRequire(import.meta.url);";

/** @param {{ root: string, input: string, file: string }} options */
export async function bundleServer({ root, input, file }) {
  await build({
    input,
    platform: 'node',
    cwd: root,
    resolve: {
      extensionAlias: { '.js': ['.ts', '.js'] },
      conditionNames: ['node', 'import', 'module', 'default'],
    },
    logLevel: 'warn',
    output: {
      file,
      format: 'esm',
      codeSplitting: false,
      banner: BANNER,
      minify: false,
    },
  });
}
