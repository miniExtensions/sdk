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
const filterCases = [
    'portalVisitorFilter.test.ts',
    'reactPortalVisitorFilter.test.ts',
    'portalVisitorFilterDropdown.test.ts',
    'reactPortalVisitorQuickFilter.test.ts',
];
const viewButtonsCase = 'reactPortalVisitorViewButtons.test.ts';
const queryCase = 'portalVisitorQuery.test.ts';
const fixture = 'fixtures/htmlPresentationFixture.ts';
const quickFilterFixture = 'fixtures/portalVisitorQuickFilterFixture.ts';
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
import { createPortalVisitorSearchDraft, type PortalVisitorSearchPort, type PortalVisitorSearchPublication } from '@miniextensions/sdk/portals';
const port: PortalVisitorSearchPort & Pick<PortalVisitorSearchProps['port'], 'subscribe'> = {
    read: () => null,
    subscribe: () => () => undefined,
    apply(command) {
        void command.expectedSearchTerm;
        const committedPublication: PortalVisitorSearchPublication = {
            generation: command.stamp.generation,
            revision: command.expectedPublicationRevision + 1,
        };
        // @ts-expect-error the captured owner is readonly
        command.stamp.generation = 9;
        return { type: 'refused', committedPublication };
    },
};
void createPortalVisitorSearchDraft(port);
void createElement(PortalVisitorSearch, { port });
`;

const typedFilter = `
import { createElement } from 'react';
import { PortalVisitorFilter, type PortalVisitorFilterProps } from '@miniextensions/sdk/react';
import { createPortalVisitorFilterDraft, type PortalVisitorFilterDraft, type PortalVisitorFilterDropdown, type PortalVisitorFilterPort, type PortalVisitorQueryOutcome } from '@miniextensions/sdk/portals';
const port: PortalVisitorFilterPort = {
    read: () => null,
    subscribe: () => () => undefined,
    apply({stamp, criteria}) {
        void criteria?.conditions;
        // @ts-expect-error ownership is readonly
        stamp.generation = 9;
        return { type: 'refused' };
    },
};
const draft: PortalVisitorFilterDraft | null = createPortalVisitorFilterDraft(port);
void draft?.snapshot().criteria;
const quickFilters: readonly PortalVisitorFilterDropdown[] = draft?.dropdowns() ?? [];
void quickFilters.map(({selected}) => selected);
const props: PortalVisitorFilterProps = { port, showDropdowns: true };
void createElement(PortalVisitorFilter, props);
const queryOutcome: PortalVisitorQueryOutcome = { type: 'uncertain', committedGeneration: 2 };
void queryOutcome;
`;

const typedViewButtons = `
import { createElement } from 'react';
import {
    PortalVisitorViewButtons,
    type PortalVisitorViewButton,
    type PortalVisitorViewButtonsProps,
} from '@miniextensions/sdk/react';
const option: PortalVisitorViewButton = { id: 'grid', label: null };
const props: PortalVisitorViewButtonsProps = {
    views: [option],
    selectedViewId: null,
    ownerToken: 'admitted view owner',
    unnamedViewLabel: 'Localized unnamed view',
    viewBadgeDescription: 'Localized flagged view',
    onSelect(id) { void id.toUpperCase(); },
};
// @ts-expect-error metadata published to the chooser is read-only.
option.label = 'Do not mutate the host view';
void createElement(PortalVisitorViewButtons, props);
`;

function checkVisitorMatrix({ archivePath, typescriptBin }, includeQuery) {
    const archive = resolve(archivePath);
    const cases = includeQuery
        ? [
              ...sortCases,
              ...searchCases,
              viewButtonsCase,
              ...filterCases,
              queryCase,
          ]
        : sortCases;
    const expectedTests = includeQuery ? 96 : 16;
    const fixtures = includeQuery ? [fixture, quickFilterFixture] : [fixture];
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
            if (includeQuery) {
                const css = readFileSync(
                    join(
                        directory,
                        'node_modules/@miniextensions/sdk/dist/esm/react/portal-visitor-view-buttons.css'
                    ),
                    'utf8'
                );
                assert.match(css, /flex-wrap: wrap/);
                assert.match(css, /:focus-visible/);
                assert.equal(
                    readFileSync(
                        join(
                            directory,
                            'node_modules/@miniextensions/sdk/dist/cjs/react/portal-visitor-view-buttons.css'
                        ),
                        'utf8'
                    ),
                    css
                );
            }
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
                if (includeQuery) {
                    writeFileSync(
                        join(directory, 'search-consumer.' + typeSuffix),
                        typedSearch
                    );
                    writeFileSync(
                        join(directory, 'view-buttons-consumer.' + typeSuffix),
                        typedViewButtons
                    );
                    writeFileSync(
                        join(directory, 'filter-consumer.' + typeSuffix),
                        typedFilter
                    );
                }
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
                    ...(includeQuery
                        ? [
                              'search-consumer.' + typeSuffix,
                              'view-buttons-consumer.' + typeSuffix,
                              'filter-consumer.' + typeSuffix,
                          ]
                        : []),
                ]);
                for (const file of [...cases, ...fixtures]) {
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
                            "'../src/react/PortalVisitorViewButtons.js'",
                            "'@miniextensions/sdk/react'"
                        )
                        .replaceAll(
                            "'../src/portals/visitorFilter.js'",
                            "'@miniextensions/sdk/portals'"
                        )
                        .replaceAll(
                            "'../src/react/PortalVisitorFilter.js'",
                            "'@miniextensions/sdk/react'"
                        )
                        .replaceAll(
                            'htmlPresentationFixture.js',
                            'htmlPresentationFixture.' + suffix
                        )
                        .replaceAll(
                            'portalVisitorQuickFilterFixture.js',
                            'portalVisitorQuickFilterFixture.' + suffix
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
