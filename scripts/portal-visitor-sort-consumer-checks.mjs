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

const cases = [
    'portalVisitorSort.test.ts',
    'reactPortalVisitorSort.test.ts',
    'fixtures/htmlPresentationFixture.ts',
];
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

export function checkPortalVisitorSortReactMatrix({
    archivePath,
    typescriptBin,
}) {
    const archive = resolve(archivePath);
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
                ]);
                for (const file of cases) {
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
                    ...cases
                        .slice(0, 2)
                        .map((file) => file.replace(/\.ts$/, '.' + suffix)),
                ]);
                assert.match(report, /^# tests 12$/m);
                assert.match(report, /^# pass 12$/m);
                assert.match(report, /^# fail 0$/m);
                assert.match(report, /^# cancelled 0$/m);
                assert.match(report, /^# skipped 0$/m);
                output.push({ react, format, tests: 12, hydration: 'passed' });
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
