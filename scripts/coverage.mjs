import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdir, readFile, rm, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCoverage } from './coverage-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const output = 'dist/coverage-test';
const mode = process.argv[2] ?? 'all';
if (!['all', 'unit', 'component'].includes(mode)) {
    throw new Error('Expected all, unit, or component coverage.');
}
function run(script, args) {
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

// An isolated clean compile prevents stale test/source files entering coverage.
await rm(path.join(root, 'coverage', ...(mode === 'all' ? [] : [mode])), {
    recursive: true,
    force: true,
});
await rm(path.join(root, output), { recursive: true, force: true });
run(require.resolve('typescript/bin/tsc'), [
    '--project',
    'tsconfig.test.json',
    '--outDir',
    output,
]);
const groups = { unit: [], component: [] };
async function tests(directory, prefix = '') {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory())
            files.push(
                ...(await tests(path.join(directory, entry.name), `${name}/`))
            );
        else if (name.endsWith('.test.ts')) files.push(name);
    }
    return files.sort();
}
for (const name of await tests(path.join(root, 'test'))) {
    if (!name.endsWith('.test.ts')) continue;
    const source = await readFile(path.join(root, 'test', name), 'utf8');
    // Component suites explicitly mount native/React controls in happy-dom.
    // Headless controller and protocol tests remain in the unit group.
    const group = /from\s+['"]happy-dom['"]/.test(source)
        ? 'component'
        : 'unit';
    groups[group].push(`${output}/test/${name.replace(/\.ts$/, '.js')}`);
}
const c8 = require.resolve('c8/bin/c8.js');
const common = [
    '--all',
    '--src',
    `${output}/src`,
    '--include',
    `${output}/src/**/*.js`,
    '--reporter',
    'json',
    '--reporter',
    'json-summary',
    '--reporter',
    'lcov',
    '--reporter',
    'text-summary',
];
for (const group of mode === 'all' ? ['unit', 'component'] : [mode]) {
    if (groups[group].length === 0)
        throw new Error(`Empty ${group} test group.`);
    console.log(`Running ${groups[group].length} ${group} test files.`);
    run(c8, [
        ...common,
        '--reports-dir',
        `coverage/${group}`,
        '--temp-directory',
        `coverage/${group}/raw`,
        process.execPath,
        '--test',
        '--test-concurrency=1',
        ...groups[group],
    ]);
}
if (mode === 'all') {
    const raw = path.join(root, 'coverage/combined/raw');
    await rm(path.dirname(raw), { recursive: true, force: true });
    await mkdir(raw, { recursive: true });
    for (const group of ['unit', 'component']) {
        const directory = path.join(root, `coverage/${group}/raw`);
        for (const file of await readdir(directory)) {
            if (file.endsWith('.json')) {
                await copyFile(
                    path.join(directory, file),
                    path.join(raw, `${group}-${file}`)
                );
            }
        }
    }
    run(c8, [
        'report',
        ...common,
        '--reports-dir',
        'coverage/combined',
        '--temp-directory',
        'coverage/combined/raw',
    ]);
    await checkCoverage(root);
}
