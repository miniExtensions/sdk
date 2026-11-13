import { context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('./', import.meta.url));
mkdirSync(`${directory}.generated`, { recursive: true });
copyFileSync(`${directory}index.html`, `${directory}.generated/index.html`);
const bundle = await context({
    absWorkingDir: directory,
    entryPoints: ['main.ts'],
    outdir: '.generated',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
});
await bundle.watch();
const server = await bundle.serve({
    host: '127.0.0.1',
    port: 0,
    servedir: `${directory}.generated`,
});
console.log(`Portal summary cards: http://127.0.0.1:${server.port}`);
const stop = async () => {
    await bundle.dispose();
    process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
