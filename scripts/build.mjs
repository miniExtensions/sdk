import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');

for (const directory of ['dist/esm', 'dist/cjs']) {
    rmSync(directory, { recursive: true, force: true });
}

for (const project of ['tsconfig.json', 'tsconfig.cjs.json']) {
    const result = spawnSync(
        process.execPath,
        [compiler, '--project', project],
        {
            stdio: 'inherit',
        }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
