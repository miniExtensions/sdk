import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundleDatePopover } from './date-popover-vendor.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'sdk-date-popup-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dependency = join(root, 'node_modules/@radix-ui/react-popover');
    mkdirSync(join(dependency, 'dist/nested'), { recursive: true });
    writeFileSync(
        join(dependency, 'package.json'),
        JSON.stringify({
            name: '@radix-ui/react-popover',
            version: '1.0.0',
            license: 'MIT',
            type: 'module',
            main: 'dist/index.mjs',
            module: 'dist/index.mjs',
        })
    );
    const files = {
        'dist/index.mjs': "export { value } from './nested/value.mjs';\n",
        'dist/nested/value.mjs': 'export const value = 42;\n',
        LICENSE: 'MIT synthetic dependency fixture\n',
    };
    const inputs = {};
    for (const [file, bytes] of Object.entries(files)) {
        writeFileSync(join(dependency, file), bytes);
        inputs[`@radix-ui/react-popover@1.0.0/${file}`] = digest(bytes);
    }
    const receiptDirectory = join(root, 'vendor/date-popover');
    mkdirSync(receiptDirectory, { recursive: true });
    const frozen = JSON.stringify({ esm: inputs, cjs: inputs }, null, 4) + '\n';
    const receipt = join(receiptDirectory, 'UPSTREAM.json');
    writeFileSync(receipt, frozen);
    writeFileSync(join(receiptDirectory, 'LICENSES.txt'), files.LICENSE);
    const entry = "export { value } from '@radix-ui/react-popover';\n";
    for (const format of ['esm', 'cjs']) {
        const directory = join(root, 'dist', format, 'react');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'datePopoverRuntime.js'), entry);
    }
    return { root, dependency, receipt, frozen, inputs, entry };
}

test('bundles nested dependency files using unchanged frozen portable receipt keys', async (t) => {
    const { root, receipt, frozen, inputs } = fixture(t);
    await bundleDatePopover(root);
    assert.equal(readFileSync(receipt, 'utf8'), frozen);
    for (const format of ['esm', 'cjs']) {
        const directory = join(root, 'dist', format, 'react');
        const provenance = JSON.parse(
            readFileSync(join(directory, 'complete-date.provenance.json'))
        );
        assert.deepEqual(provenance, {
            format,
            external: ['react', 'react-dom'],
            inputs,
        });
        assert.equal(
            readFileSync(join(directory, 'complete-date.LICENSES.txt'), 'utf8'),
            'MIT synthetic dependency fixture\n'
        );
    }
});

for (const mutation of ['changed bytes', 'new reachable file']) {
    test(`rejects ${mutation} without changing the frozen receipt`, async (t) => {
        const { root, dependency, receipt, frozen, entry } = fixture(t);
        await bundleDatePopover(root);
        const nested = join(dependency, 'dist/nested/value.mjs');
        let nextEntry = entry;
        if (mutation === 'changed bytes') {
            writeFileSync(nested, 'export const value = 43;\n');
        } else {
            writeFileSync(
                join(dependency, 'dist/nested/unexpected.mjs'),
                'export const extra = 42;\n'
            );
            nextEntry +=
                "export { extra } from '@radix-ui/react-popover/dist/nested/unexpected.mjs';\n";
        }
        // Restore the compiler entry, rather than rebundling an already inlined output.
        for (const format of ['esm', 'cjs']) {
            writeFileSync(
                join(root, 'dist', format, 'react/datePopoverRuntime.js'),
                nextEntry
            );
        }
        await assert.rejects(bundleDatePopover(root), {
            code: 'ERR_ASSERTION',
            message:
                /Date popup closure changed; qualify supported dependency updates/,
        });
        assert.equal(readFileSync(receipt, 'utf8'), frozen);
    });
}
