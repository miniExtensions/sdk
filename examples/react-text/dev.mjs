import { context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
mkdirSync(`${root}/.generated`, { recursive: true });
copyFileSync(`${root}/index.html`, `${root}/.generated/index.html`);
const bundle = await context({
    absWorkingDir: root,
    entryPoints: ['main.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir: '.generated',
});
await bundle.watch();
const server = await bundle.serve({
    host: '127.0.0.1',
    port: 4177,
    servedir: `${root}/.generated`,
});
console.log(`Text example: http://127.0.0.1:${server.port}`);
