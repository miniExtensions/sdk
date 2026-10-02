import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const output = new URL('.generated/', root);
mkdirSync(output, { recursive: true });
const result = await build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: fileURLToPath(new URL('main.js', output)),
    sourcemap: true,
    metafile: true,
});
for (const filename of ['index.html', 'styles.css']) {
    copyFileSync(new URL(filename, root), new URL(filename, output));
}
writeFileSync(
    new URL('metafile.json', output),
    JSON.stringify(result.metafile, null, 4) + '\n'
);
