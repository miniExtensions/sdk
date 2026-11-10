import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { recordPortalChartInputs } from './complete-portal-chart-browser-checks.mjs';

function fixture(t, format) {
    const temporary = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-chart-inputs-'))
    );
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const installed = join(temporary, 'node_modules/@miniextensions/sdk');
    const archiveRoot = join(temporary, 'archive');
    const archive = join(temporary, 'sdk.tgz');
    const chartRoot = join(temporary, 'node_modules/chart.js');
    const inputs = {};
    const write = (path, text) => {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, text);
    };
    const sdkInput = (member, bytes = `packed ${member}`) => {
        const path = join(installed, member);
        write(path, bytes);
        write(join(archiveRoot, 'package', member), bytes);
        inputs[relative(temporary, path)] = {};
        return path;
    };
    sdkInput(`dist/${format}/react/CompletePortalChart.js`);
    sdkInput('dist/vendor/phone-number-input/index.cjs');
    const rich = sdkInput('dist/vendor/rich-markdown-editor/dist/index.js');
    for (const path of [
        join(chartRoot, `dist/chart.${format === 'esm' ? 'js' : 'cjs'}`),
        join(temporary, 'node_modules/react/cjs/react.development.js'),
        join(temporary, 'node_modules/react-dom/cjs/react-dom.development.js'),
    ]) {
        write(path, 'fixture input');
        inputs[relative(temporary, path)] = {};
    }
    const pack = () =>
        execFileSync('tar', ['-czf', archive, '-C', archiveRoot, 'package']);
    const record = () =>
        recordPortalChartInputs({
            metafile: { inputs },
            temporary,
            installed,
            archive,
            format,
            regular: readFileSync,
            hash: (bytes) => createHash('sha256').update(bytes).digest('hex'),
            chartRoot,
        });
    pack();
    return { record, sdkInput, pack, rich };
}

for (const format of ['esm', 'cjs']) {
    test(`${format} Chart provenance accepts both exact shared closures and binds their bytes to the archive`, (t) => {
        const { record, rich } = fixture(t, format);
        const receipt = record();
        assert.ok(
            receipt.some(
                (entry) =>
                    entry.archiveMember ===
                    'package/dist/vendor/rich-markdown-editor/dist/index.js'
            )
        );
        assert.ok(
            receipt.some(
                (entry) =>
                    entry.archiveMember ===
                    'package/dist/vendor/phone-number-input/index.cjs'
            )
        );
        writeFileSync(rich, 'installed bytes differ from packed bytes');
        assert.throws(record, assert.AssertionError);
    });

    for (const member of [
        `dist/${format === 'esm' ? 'cjs' : 'esm'}/react/index.js`,
        'src/react/CompletePortalChart.ts',
        'dist/vendor/unrecognized/index.js',
        'dist/vendor/rich-markdown-editor-other/index.js',
        'dist/vendor/phone-number-input-other/index.js',
    ]) {
        test(`${format} Chart provenance rejects ${member} even when its archive bytes match`, (t) => {
            const { record, sdkInput, pack } = fixture(t, format);
            assert.doesNotThrow(record);
            sdkInput(member);
            pack();
            assert.throws(record, /source alias or wrong SDK format/);
        });
    }
}
