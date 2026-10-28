// Bundles src/main.ts into main.js, the only script Obsidian loads (AC-F.2).
// obsidian, electron and Node's built-ins are provided at run time: never bundled.
import { builtinModules } from 'node:module';
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  external: ['obsidian', 'electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  sourcemap: false,
  minify: false,
  legalComments: 'inline',
  logLevel: 'info',
});
