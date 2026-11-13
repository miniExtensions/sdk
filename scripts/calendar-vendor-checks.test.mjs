import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import {
    assertCalendarVendor,
    bundleCalendar,
} from './calendar-vendor-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const upstream = JSON.parse(
    readFileSync(join(root, 'vendor/calendar/UPSTREAM.json'), 'utf8')
);
const aliases = {
    'react-aria': 'calendar-react-aria',
    'react-stately': 'react-stately',
    '@internationalized/date': '@internationalized/date',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function packageRoot(alias) {
    for (
        let directory = dirname(realpathSync(require.resolve(alias)));
        ;
        directory = dirname(directory)
    ) {
        try {
            if (
                JSON.parse(
                    readFileSync(join(directory, 'package.json'), 'utf8')
                ).name
            )
                return directory;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        assert.notEqual(dirname(directory), directory);
    }
}

function fixture({ copyInputs = false, addFuse = false } = {}) {
    const directory = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-calendar-vendor-'))
    );
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            name: '@miniextensions/sdk',
            private: true,
            type: 'module',
        })
    );
    mkdirSync(join(directory, 'vendor'), { recursive: true });
    cpSync(join(root, 'vendor/calendar'), join(directory, 'vendor/calendar'), {
        recursive: true,
    });
    for (const [name, alias] of Object.entries(aliases)) {
        const target = join(directory, 'node_modules', alias);
        mkdirSync(dirname(target), { recursive: true });
        const source = packageRoot(alias);
        if (copyInputs) {
            mkdirSync(target);
            const files = [
                'package.json',
                ...Object.keys(upstream.allowedPackages[name].licenseFiles),
                ...Object.keys(upstream.rootEntrySha256[name]),
            ];
            for (const file of files) {
                mkdirSync(dirname(join(target, file)), { recursive: true });
                cpSync(join(source, file), join(target, file));
            }
        } else symlinkSync(source, target, 'dir');
    }
    if (addFuse)
        symlinkSync(
            packageRoot('fuse.js'),
            join(directory, 'node_modules/fuse.js'),
            'dir'
        );
    return {
        directory,
        cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
}

it('qualifies the selected Calendar graph without changing the other picker graph', () => {
    const actual = assertCalendarVendor(root);
    assert.equal(actual.allowedPackages['react-aria'].version, '3.53.0');
    assert.equal(actual.allowedPackages['react-stately'].version, '3.51.0');
    assert.equal(
        actual.allowedPackages['@internationalized/date'].version,
        '3.12.4'
    );
    const headless = JSON.parse(
        readFileSync(
            join(root, 'vendor/collaborator-picker/UPSTREAM.json'),
            'utf8'
        )
    );
    assert.equal(headless.allowedPackages['react-aria'].version, '3.53.1');
});

it('refuses changed Calendar versions, license bytes and root API bytes before bundling', () => {
    for (const corruption of ['version', 'license', 'entry', 'notices']) {
        const owned = fixture({ copyInputs: true });
        try {
            const aria = join(
                owned.directory,
                'node_modules/calendar-react-aria'
            );
            if (corruption === 'version') {
                const manifest = JSON.parse(
                    readFileSync(join(aria, 'package.json'), 'utf8')
                );
                manifest.version = '3.53.1';
                writeFileSync(
                    join(aria, 'package.json'),
                    JSON.stringify(manifest)
                );
            } else {
                const path =
                    corruption === 'license'
                        ? join(aria, 'LICENSE')
                        : corruption === 'entry'
                          ? join(aria, 'dist/exports/index.cjs')
                          : join(
                                owned.directory,
                                'vendor/calendar/LICENSES.txt'
                            );
                writeFileSync(
                    path,
                    Buffer.concat([
                        readFileSync(path),
                        Buffer.from('\nchanged\n'),
                    ])
                );
            }
            assert.throws(
                () => assertCalendarVendor(owned.directory),
                assert.AssertionError
            );
        } finally {
            owned.cleanup();
        }
    }
});

function writeEntries(directory, unreviewed = false) {
    for (const format of ['esm', 'cjs']) {
        const destination = join(directory, 'dist', format, 'react');
        mkdirSync(destination, { recursive: true });
        writeFileSync(
            join(destination, 'CalendarMonthGrid.js'),
            format === 'esm'
                ? `import * as React from 'react';
import {useCalendar,useCalendarCell,useCalendarGrid} from 'calendar-react-aria';
import {useCalendarState} from 'react-stately';
import {parseDate} from '@internationalized/date';
export function CalendarMonthGrid(props){return React.createElement('div',null,props.children);}
export {useCalendar,useCalendarCell,useCalendarGrid,useCalendarState,parseDate};
${unreviewed ? "export {default as unexpected} from 'fuse.js';" : ''}
`
                : 'exports.NOT_THE_BUNDLE_INPUT = true;\n'
        );
    }
}

it('bundles the actual selected packages with external React peers and byte-verifiable receipts', async () => {
    const owned = fixture();
    try {
        writeEntries(owned.directory);
        const sourceEntry = 'dist/esm/react/CalendarMonthGrid.js';
        const sourceSha256 = hash(
            readFileSync(join(owned.directory, sourceEntry))
        );
        const outputs = await bundleCalendar(owned.directory);
        assert.equal(outputs.length, 2);
        for (const format of ['esm', 'cjs']) {
            const base = join(owned.directory, 'dist', format, 'react');
            const receipt = JSON.parse(
                readFileSync(join(base, 'calendar-vendor.json'), 'utf8')
            );
            assert.equal(
                receipt.sha256,
                hash(readFileSync(join(base, 'CalendarMonthGrid.js')))
            );
            assert.equal(receipt.sourceEntry, sourceEntry);
            assert.equal(receipt.sourceSha256, sourceSha256);
            assert(
                !readFileSync(
                    join(base, 'CalendarMonthGrid.js'),
                    'utf8'
                ).includes('NOT_THE_BUNDLE_INPUT')
            );
            assert.equal(
                receipt.licensesSha256,
                hash(readFileSync(join(base, 'calendar.LICENSES.txt')))
            );
            assert(
                receipt.packages.some(
                    (item) =>
                        item.name === 'react-aria' && item.version === '3.53.0'
                )
            );
            assert(
                receipt.packages.some(
                    (item) =>
                        item.name === 'react-stately' &&
                        item.version === '3.51.0'
                )
            );
            assert(
                receipt.packages.some(
                    (item) =>
                        item.name === '@internationalized/date' &&
                        item.version === '3.12.4'
                )
            );
            assert(
                receipt.packages.every(
                    (item) => !['react', 'react-dom'].includes(item.name)
                )
            );
            assert(
                receipt.inputs.some(
                    (item) =>
                        item.package === 'react-aria' &&
                        item.path.endsWith('.mjs')
                )
            );
            assert(
                !receipt.inputs.some(
                    (item) =>
                        item.package === 'react-aria' &&
                        item.path.endsWith('.cjs')
                ),
                'Both outputs must use static upstream ESM imports'
            );
            assert(
                receipt.inputs.every((item) =>
                    /^[a-f0-9]{64}$/.test(item.sha256)
                )
            );
            assert(receipt.external.includes('react'));
            assert(receipt.external.includes('react-dom'));
            assert(
                receipt.external.every((item) =>
                    /^(?:react|react-dom)(?:\/.*)?$/.test(item)
                )
            );
        }
    } finally {
        owned.cleanup();
    }
});

it('refuses an unreviewed package entering the Calendar closure', async () => {
    const owned = fixture({ addFuse: true });
    try {
        writeEntries(owned.directory, true);
        await assert.rejects(
            bundleCalendar(owned.directory),
            /Unreviewed Calendar dependency: fuse\.js/
        );
    } finally {
        owned.cleanup();
    }
});
