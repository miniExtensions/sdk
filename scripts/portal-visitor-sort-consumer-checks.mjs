import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';

const sortCases = [
    'portalVisitorSort.test.ts',
    'reactPortalVisitorSort.test.ts',
];
const searchCases = [
    'portalVisitorSearch.test.ts',
    'reactPortalVisitorSearch.test.ts',
];
const fixture = 'fixtures/htmlPresentationFixture.ts';
const profiles = [
    ['18.3.1', '18.3.12', '18.3.1'],
    ['19.2.0', '19.2.2', '19.2.2'],
];
const typed = `
import { createElement } from 'react';
import { PortalVisitorSort } from '@miniextensions/sdk/react';
import { createPortalVisitorSortDraft, type PortalVisitorSortPort } from '@miniextensions/sdk/portals';
const port: PortalVisitorSortPort = {
    read: () => null,
    subscribe: () => () => undefined,
    apply: ({stamp, criteria}) => {
        void stamp.generation;
        // @ts-expect-error accepted wire order is readonly
        criteria.reverse();
        return { type: 'refused' };
    },
};
void createPortalVisitorSortDraft(port);
void createElement(PortalVisitorSort, { port });
`;

const typedSearch = `
import { createElement } from 'react';
import { PortalVisitorSearch, type PortalVisitorSearchProps } from '@miniextensions/sdk/react';
import { createPortalVisitorSearchDraft, type PortalVisitorSearchPort } from '@miniextensions/sdk/portals';
const port: PortalVisitorSearchPort & Pick<PortalVisitorSearchProps['port'], 'subscribe'> = {
    read: () => null,
    subscribe: () => () => undefined,
    apply(command) {
        void command.expectedSearchTerm;
        // @ts-expect-error the captured owner is readonly
        command.stamp.generation = 9;
        return { type: 'refused' };
    },
};
void createPortalVisitorSearchDraft(port);
void createElement(PortalVisitorSearch, { port });
`;

function checkVisitorMatrix({ archivePath, typescriptBin }, includeSearch) {
    const archive = resolve(archivePath);
    const cases = includeSearch ? [...sortCases, ...searchCases] : sortCases;
    const expectedTests = includeSearch ? 22 : 12;
    const output = [];
    for (const [react, types, domTypes] of profiles) {
        const directory = mkdtempSync(
            join(tmpdir(), 'sdk-portal-visitor-sort-')
        );
        try {
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': 'file:' + archive,
                        react,
                        'react-dom': react,
                        '@types/react': types,
                        '@types/react-dom': domTypes,
                        'happy-dom': '20.0.11',
                    },
                })
            );
            installAgeQualifiedConsumer({
                directory,
                args: ['install', '--ignore-scripts'],
            });
            mkdirSync(join(directory, 'fixtures'));
            const run = (argv) =>
                execFileSync(process.execPath, argv, {
                    cwd: directory,
                    encoding: 'utf8',
                    timeout: 120000,
                });
            for (const [format, suffix, typeSuffix] of [
                ['esm', 'mjs', 'mts'],
                ['cjs', 'cjs', 'cts'],
            ]) {
                writeFileSync(join(directory, 'consumer.' + typeSuffix), typed);
                if (includeSearch)
                    writeFileSync(
                        join(directory, 'search-consumer.' + typeSuffix),
                        typedSearch
                    );
                run([
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    'consumer.' + typeSuffix,
                    ...(includeSearch ? ['search-consumer.' + typeSuffix] : []),
                ]);
                for (const file of [...cases, fixture]) {
                    const source = readFileSync(
                        new URL('../test/' + file, import.meta.url),
                        'utf8'
                    )
                        .replaceAll(
                            "'../src/portals/index.js'",
                            "'@miniextensions/sdk/portals'"
                        )
                        .replaceAll(
                            "'../src/react/PortalVisitorSort.js'",
                            "'@miniextensions/sdk/react'"
                        )
                        .replaceAll(
                            "'../src/react/PortalVisitorSearch.js'",
                            "'@miniextensions/sdk/react'"
                        )
                        .replaceAll(
                            'htmlPresentationFixture.js',
                            'htmlPresentationFixture.' + suffix
                        );
                    writeFileSync(
                        join(directory, file.replace(/\.ts$/, '.' + suffix)),
                        transformSync(source, {
                            loader: 'ts',
                            format,
                            target: 'es2022',
                        }).code
                    );
                }
                const report = run([
                    '--test',
                    '--test-reporter=tap',
                    '--test-concurrency=1',
                    ...cases.map((file) => file.replace(/\.ts$/, '.' + suffix)),
                ]);
                assert.match(
                    report,
                    new RegExp(`^# tests ${expectedTests}$`, 'm')
                );
                assert.match(
                    report,
                    new RegExp(`^# pass ${expectedTests}$`, 'm')
                );
                assert.match(report, /^# fail 0$/m);
                assert.match(report, /^# cancelled 0$/m);
                assert.match(report, /^# skipped 0$/m);
                output.push({
                    react,
                    format,
                    tests: expectedTests,
                    hydration: 'passed',
                });
            }
        } finally {
            rmSync(directory, { recursive: true });
        }
    }
    return {
        profiles: output,
        tests: output.reduce((count, row) => count + row.tests, 0),
        cleanup: 'completed',
    };
}

export function checkPortalVisitorSortReactMatrix(options) {
    return checkVisitorMatrix(options, false);
}

export function checkPortalVisitorQueryReactMatrix(options) {
    return checkVisitorMatrix(options, true);
}
