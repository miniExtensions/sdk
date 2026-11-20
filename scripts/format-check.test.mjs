import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the contributor format check accepts checkout line endings but rejects formatting defects', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-format-check-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    cpSync(
        new URL('../.prettierrc.json', import.meta.url),
        join(directory, '.prettierrc.json')
    );
    const manifest = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    const [command, script, ...args] =
        manifest.scripts['format:check'].split(/\s+/);
    assert.equal(command, 'node');
    const entry = fileURLToPath(new URL(`../${script}`, import.meta.url));
    const check = () =>
        spawnSync(process.execPath, [entry, ...args], {
            cwd: directory,
            encoding: 'utf8',
        });
    writeFileSync(join(directory, '.prettierignore'), 'vendor\n');
    mkdirSync(join(directory, 'vendor'));
    const ignored = join(directory, 'vendor', 'ignored.mjs');
    const ignoredContent = 'definitely } invalid\r';
    writeFileSync(ignored, ignoredContent);
    mkdirSync(join(directory, 'nested'));
    writeFileSync(
        join(directory, 'nested', '.prettierrc.json'),
        '{ "singleQuote": false }\n'
    );
    writeFileSync(
        join(directory, 'nested', 'override.mjs'),
        'export const name = "nested";\r\n'
    );
    const sample = join(directory, 'sample.mjs');
    const canonical = "const value = 'value';\nexport { value };\n";
    for (const content of [canonical, canonical.replaceAll('\n', '\r\n')]) {
        writeFileSync(sample, content);
        const result = check();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readFileSync(sample, 'utf8'), content);
    }
    for (const content of [
        "const value='value';\r\nexport { value };\r\n",
        "const value = 'value';\r\nexport { value };\n",
        canonical.replaceAll('\n', '\r'),
        'const value = "value";\r\nexport { value };\r\n',
    ]) {
        writeFileSync(sample, content);
        const result = check();
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(result.stderr, /sample\.mjs/);
        assert.equal(readFileSync(sample, 'utf8'), content);
    }
    assert.equal(readFileSync(ignored, 'utf8'), ignoredContent);
});

test('the contributor format check preserves explicitly configured line endings', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-format-override-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, 'nested');
    mkdirSync(source);
    const config = join(source, '.prettierrc.json');
    const file = join(source, 'example.mjs');
    const require = createRequire(import.meta.url);
    const prettier = require.resolve('prettier/bin/prettier.cjs');
    const wrapper = fileURLToPath(
        new URL('./format-check.mjs', import.meta.url)
    );
    for (const [endOfLine, content, expected] of [
        ['cr', 'export const value = 1;\r', 0],
        ['lf', 'export const value = 1;\r\n', 1],
    ]) {
        writeFileSync(
            config,
            `{ "endOfLine": "${endOfLine}" }${endOfLine === 'cr' ? '\r' : '\n'}`
        );
        writeFileSync(file, content);
        for (const args of [[prettier, '--check', '.'], [wrapper]]) {
            const result = spawnSync(process.execPath, args, {
                cwd: directory,
                encoding: 'utf8',
            });
            assert.equal(
                result.status,
                expected,
                result.stderr || result.stdout
            );
            assert.equal(readFileSync(file, 'utf8'), content);
        }
    }
});
