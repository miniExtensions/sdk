import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveConfig } from 'prettier';

const require = createRequire(import.meta.url);
const prettier = require.resolve('prettier/bin/prettier.cjs');
const run = (args) => {
    const result = spawnSync(process.execPath, [prettier, ...args], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Prettier stopped on ${result.signal}`);
    return result;
};

// Use the original formatter and its own path/config/ignore resolution first.
// Only files that already failed this check can need the CRLF accommodation.
const strict = run(['--list-different', '.']);
if (strict.stderr) process.stderr.write(strict.stderr);
if (strict.status === 0) {
    console.log('All matched files use Prettier code style!');
} else if (strict.status !== 1) {
    if (strict.stdout) process.stdout.write(strict.stdout);
    process.exitCode = strict.status ?? 2;
} else {
    const changed = strict.stdout.split(/\r?\n/).filter(Boolean);
    // Only accommodate a checkout newline difference when the path does not
    // explicitly configure line endings. Prettier auto also accepts bare CR.
    const failures = [];
    for (const path of changed) {
        const config = await resolveConfig(path, { editorconfig: true });
        if (config?.endOfLine !== undefined) {
            failures.push(`${path}: configured endOfLine ${config.endOfLine}`);
        } else if (/\r(?!\n)/.test(readFileSync(path, 'utf8'))) {
            failures.push(`${path}: unsupported bare carriage returns`);
        }
    }
    if (failures.length > 0) {
        console.error(failures.join('\n'));
        process.exitCode = 1;
    } else {
        const check = run(['--check', '.', '--end-of-line', 'auto']);
        if (check.stdout) process.stdout.write(check.stdout);
        if (check.stderr) process.stderr.write(check.stderr);
        process.exitCode = check.status ?? 2;
    }
}
