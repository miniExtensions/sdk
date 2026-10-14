import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
mkdirSync(`${root}/.generated`, { recursive: true });
copyFileSync(`${root}/index.html`, `${root}/.generated/index.html`);
await build({
    absWorkingDir: root,
    entryPoints: ['main.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir: '.generated',
});
console.log('AutoNumber example built in examples/react-autonumber/.generated');
