import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'fs';

// Clean dist/
try { rmSync('dist', { recursive: true, force: true }); } catch {}
mkdirSync('dist', { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  minify: true,
  // Keep external — native addons and packages that must stay as runtime deps
  external: [
    '@modelcontextprotocol/sdk',
    'keytar',
    'ws',
    // Node built-ins are auto-external in platform:node
  ],
  // Inline template files as text strings
  loader: {
    '.md':  'text',
    '.mdc': 'text',
  },
  define: {
    // esbuild replaces these so __dirname works in the bundle
  },
};

await Promise.all([
  build({ ...shared, entryPoints: ['src/index.js'], outfile: 'dist/index.js' }),
  build({ ...shared, entryPoints: ['src/http.js'],  outfile: 'dist/http.js'  }),
  build({ ...shared, entryPoints: ['src/cli.js'],   outfile: 'dist/cli.js'   }),
]);

console.log('✓ build complete → dist/');
