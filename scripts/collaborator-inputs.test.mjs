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
import { prepareCompleteCollaboratorFixtures } from './complete-collaborator-browser-checks.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

const addressFiles = ['combobox.js', 'react-peer.js', 'sdk-runtime.js'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t, format) {
    const temporary = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-collaborator-inputs-'))
    );
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const installed = join(temporary, 'node_modules/@miniextensions/sdk');
    const archiveRoot = join(temporary, 'archive');
    const archive = join(temporary, 'sdk.tgz');
    const inputs = { esm: {}, cjs: {} };
    const creators = {};
    const write = (path, bytes) => {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, bytes);
    };
    const sdkInput = (member, formats = [format]) => {
        const path = join(installed, member);
        const bytes = `packed ${member}`;
        write(path, bytes);
        write(join(archiveRoot, 'package', member), bytes);
        for (const target of formats)
            inputs[target][relative(temporary, path)] = {};
        return path;
    };
    write(
        join(temporary, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
    );
    write(
        join(installed, 'package.json'),
        JSON.stringify({
            name: '@miniextensions/sdk',
            exports: {
                './react/complete-collaborators.css':
                    './dist/esm/react/complete-collaborators.css',
            },
        })
    );
    sdkInput('dist/esm/react/complete-collaborators.css', []);
    write(
        join(temporary, 'node_modules/react/package.json'),
        JSON.stringify({ version: '19.2.0' })
    );
    for (const target of ['esm', 'cjs']) {
        sdkInput(`dist/${target}/react/CompleteCollaboratorField.js`, [target]);
        creators[target] = sdkInput(`dist/${target}/react/CreatedByField.js`, [
            target,
        ]);
        sdkInput(`dist/${target}/react/completeCollaboratorPickerRuntime.js`, [
            target,
        ]);
        for (const member of [
            'node_modules/react/cjs/react.development.js',
            'node_modules/react-dom/cjs/react-dom.development.js',
        ]) {
            const path = join(temporary, member);
            write(path, 'provenance fixture input');
            inputs[target][member] = {};
        }
    }
    sdkInput('dist/vendor/phone-number-input/index.cjs', ['esm', 'cjs']);
    sdkInput('dist/vendor/rich-markdown-editor/dist/index.js', ['esm', 'cjs']);
    const address = addressFiles.map((name) =>
        sdkInput(`dist/vendor/headlessui-address/${name}`, ['esm', 'cjs'])
    );
    const pack = () =>
        execFileSync('tar', ['-czf', archive, '-C', archiveRoot, 'package']);
    const report = {};
    let beforeSelectedBuild = () => {};
    const record = () =>
        prepareCompleteCollaboratorFixtures({
            temporary,
            installed,
            archive,
            report,
            allowed: new Map(),
            regular: readFileSync,
            hash,
            assertBrowserInputs,
            // Only bundler metadata is controlled here. The real fixture
            // preparation, path checks, tar reads and byte/hash binding run.
            build: async ({ entryPoints }) => {
                const target = entryPoints[0].endsWith('.cjs') ? 'cjs' : 'esm';
                if (target === format) beforeSelectedBuild(inputs[target]);
                return {
                    metafile: { inputs: inputs[target] },
                    outputFiles: [
                        { contents: Buffer.from('provenance unit fixture') },
                    ],
                };
            },
        });
    pack();
    return {
        record,
        sdkInput,
        pack,
        address,
        report,
        creator: creators[format],
        temporary,
        beforeBuild(action) {
            beforeSelectedBuild = action;
        },
    };
}

for (const format of ['esm', 'cjs']) {
    test(`${format} Collaborator provenance binds the actual packed CreatedBy member`, async (t) => {
        const { record, creator, report } = fixture(t, format);
        await record();
        const evidence = report.completeCollaborators[format];
        assert.equal(
            evidence.packagedCreatedByMember,
            `package/dist/${format}/react/CreatedByField.js`
        );
        assert.equal(
            evidence.packagedCreatedBySha256,
            hash(readFileSync(creator))
        );
    });

    for (const change of ['changed-bytes', 'missing-input']) {
        test(`${format} Collaborator provenance rejects CreatedBy ${change}`, async (t) => {
            const { record, creator, temporary, beforeBuild, report } = fixture(
                t,
                format
            );
            await record();
            beforeBuild((inputs) => {
                if (change === 'changed-bytes')
                    writeFileSync(creator, 'changed installed creator bytes');
                else delete inputs[relative(temporary, creator)];
            });
            await assert.rejects(record, assert.AssertionError);
            assert.equal(report.completeCollaborators[format], undefined);
            if (format === 'cjs') assert(report.completeCollaborators.esm);
        });
    }

    test(`${format} Collaborator provenance binds each shipped Address runtime input to its archive bytes`, async (t) => {
        const { record, address, report } = fixture(t, format);
        await record();
        const inputs = report.completeCollaborators[format].bundleInputs;
        for (const [index, name] of addressFiles.entries()) {
            const item = inputs.find(
                (entry) =>
                    entry.archiveMember ===
                    `package/dist/vendor/headlessui-address/${name}`
            );
            assert(item);
            assert.equal(item.sha256, hash(readFileSync(address[index])));
            assert.equal(item.bytes, readFileSync(address[index]).length);
        }
    });

    for (const [index, name] of addressFiles.entries()) {
        test(`${format} Collaborator provenance rejects changed installed Address ${name}`, async (t) => {
            const { record, address, beforeBuild, report } = fixture(t, format);
            await record();
            beforeBuild(() =>
                writeFileSync(
                    address[index],
                    'installed bytes differ from archive'
                )
            );
            await assert.rejects(record, assert.AssertionError);
            assert.equal(report.completeCollaborators[format], undefined);
            if (format === 'cjs') assert(report.completeCollaborators.esm);
        });
    }

    for (const member of [
        `dist/${format === 'esm' ? 'cjs' : 'esm'}/react/index.js`,
        'src/react/CompleteCollaboratorField.ts',
        'dist/vendor/unrecognized/index.js',
        'dist/vendor/rich-markdown-editor-other/index.js',
        'dist/vendor/phone-number-input-other/index.js',
        'dist/vendor/headlessui-address-other/combobox.js',
        'dist/vendor/headlessui-address/unreviewed.js',
    ]) {
        test(`${format} Collaborator provenance rejects ${member} even with matching archive bytes`, async (t) => {
            const { record, sdkInput, pack } = fixture(t, format);
            await record();
            sdkInput(member);
            pack();
            await assert.rejects(
                record,
                /outside dist|source or wrong SDK format/
            );
        });
    }
}
