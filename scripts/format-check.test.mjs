import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

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
    const [command, ...args] = manifest.scripts['format:check'].split(/\s+/);
    assert.equal(command, 'prettier');
    const require = createRequire(import.meta.url);
    const binary = require.resolve('prettier/bin/prettier.cjs');
    const check = () =>
        spawnSync(process.execPath, [binary, ...args], {
            cwd: directory,
            encoding: 'utf8',
        });
    const sample = join(directory, 'sample.mjs');
    const canonical = 'const value = 1;\nexport { value };\n';
    for (const content of [canonical, canonical.replaceAll('\n', '\r\n')]) {
        writeFileSync(sample, content);
        const result = check();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readFileSync(sample, 'utf8'), content);
    }
    for (const content of [
        'const value=1;\r\nexport { value };\r\n',
        'const value = 1;\r\nexport { value };\n',
    ]) {
        writeFileSync(sample, content);
        const result = check();
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(result.stderr, /sample\.mjs/);
        assert.equal(readFileSync(sample, 'utf8'), content);
    }
});
