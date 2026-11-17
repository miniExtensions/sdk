import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transformSync } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

export const readonlyPortalGridTypedConsumer = String.raw`
import {createElement} from 'react';
import {ReadonlyPortalGrid,type ReadonlyPortalGridProps,type ReadonlyPortalGridRow,type ReadonlyPortalGridColumn} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/readonly-portal-grid.css';
const columns:readonly ReadonlyPortalGridColumn[]=[{fieldId:'name',title:'Name',icon:'text'}];
const rows:readonly ReadonlyPortalGridRow[]=[{recordId:'row',cells:[{fieldId:'name',node:'Admitted display'}]}];
const props:ReadonlyPortalGridProps={columns,rows,primaryFieldId:'name',revision:1,preferenceScopeKey:'consumer-view',ready:true,isCurrent:()=>true,hiddenColumns:{},columnWidths:{name:'200'},allowHideColumns:true,onFieldHiddenChange(change){void change.isHidden;},onColumnWidthCommit(change){void change.width;},onOpenRecord(id,trigger){void id;trigger.focus();},doNotAllowUserToCopyTextOnGrid:false,rowHeight:'short'};
createElement(ReadonlyPortalGrid,props);
// @ts-expect-error admitted row collections remain readonly
rows.push(rows[0]!);
// @ts-expect-error admitted columns remain readonly
columns[0]!.title='Replacement';
// @ts-expect-error complete table presentation has no native row renderer slot
const renderer:ReadonlyPortalGridProps={...props,renderRow:()=>null};
// @ts-expect-error the presenter grants no collection transport port
const reader:ReadonlyPortalGridProps={...props,queryRecords:async()=>[]};
// @ts-expect-error readonly Grid does not gain a record writer
const writer:ReadonlyPortalGridProps={...props,setValue:()=>{}};
void renderer;void reader;void writer;
`;

/** Run unchanged parity assertions against the installed public package. */
export async function checkReadonlyPortalGridReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = realpathSync(archivePath);
    const archiveSha256 = createHash('sha256')
        .update(readFileSync(archivePath))
        .digest('hex');
    const source = readFileSync(
        fileURLToPath(
            new URL('../test/reactReadonlyPortalGrid.test.ts', import.meta.url)
        ),
        'utf8'
    );
    const fixture = readFileSync(
        fileURLToPath(
            new URL(
                '../test/fixtures/htmlPresentationFixture.ts',
                import.meta.url
            )
        ),
        'utf8'
    );
    assert(source.includes("'../src/react/ReadonlyPortalGrid.js'"));
    const profiles = [];
    const componentCases = 20;
    for (const [react, types, domTypes] of [
        ['18.3.1', '18.3.12', '18.3.1'],
        ['19.2.0', '19.2.2', '19.2.2'],
    ]) {
        const root = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-readonly-portal-grid-'))
        );
        let completedProfile;
        try {
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react,
                        'react-dom': react,
                        '@types/react': types,
                        '@types/react-dom': domTypes,
                        '@types/node': '22.20.5',
                        'happy-dom': '20.0.11',
                    },
                })
            );
            const receipt = installAgeQualifiedConsumer({
                directory: root,
                args: ['install', '--ignore-scripts'],
            });
            assert.equal(receipt.archiveSha256, archiveSha256);
            const require = createRequire(join(root, 'package.json'));
            const cssPath = require.resolve(
                '@miniextensions/sdk/react/readonly-portal-grid.css'
            );
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 120000,
                    env: {
                        ...process.env,
                        SDK_READONLY_PORTAL_GRID_CSS: cssPath,
                    },
                });
            for (const [extension, module, resolution] of [
                ['mts', 'NodeNext', 'NodeNext'],
                ['cts', 'NodeNext', 'NodeNext'],
                ['ts', 'ESNext', 'Bundler'],
            ]) {
                const name = `grid.${extension}`;
                writeFileSync(
                    join(root, name),
                    readonlyPortalGridTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    module,
                    '--moduleResolution',
                    resolution,
                    name,
                ]);
            }
            for (const format of ['esm', 'cjs']) {
                const extension = format === 'esm' ? 'mjs' : 'cjs';
                writeFileSync(
                    join(root, `grid-fixture.${extension}`),
                    transformSync(fixture, {
                        loader: 'ts',
                        format,
                        target: 'es2022',
                    }).code
                );
                const installedSource = source
                    .replaceAll(
                        '../src/react/ReadonlyPortalGrid.js',
                        '@miniextensions/sdk/react'
                    )
                    .replaceAll(
                        './fixtures/htmlPresentationFixture.js',
                        `./grid-fixture.${extension}`
                    );
                assert(!installedSource.includes('../src/'));
                const testName = `grid.${format}.test.${extension}`;
                writeFileSync(
                    join(root, testName),
                    transformSync(installedSource, {
                        loader: 'ts',
                        format,
                        target: 'es2022',
                    }).code
                );
                const output = run(process.execPath, [
                    '--test',
                    '--test-reporter=tap',
                    testName,
                ]);
                for (const [name, count] of [
                    ['tests', componentCases],
                    ['pass', componentCases],
                    ['fail', 0],
                    ['skipped', 0],
                    ['cancelled', 0],
                ])
                    assert.match(output, new RegExp(`# ${name} ${count}\\b`));
                profiles.push({
                    react,
                    format,
                    tests: componentCases,
                    failures: 0,
                    archiveSha256,
                    lockSha256: receipt.lockSha256,
                });
            }
            const css = readFileSync(cssPath, 'utf8');
            assert.equal(
                css,
                readFileSync(
                    join(
                        root,
                        'node_modules/@miniextensions/sdk/dist/cjs/react/readonly-portal-grid.css'
                    ),
                    'utf8'
                )
            );
            for (const pixels of [24, 52, 84, 140])
                assert.match(css, new RegExp(`height:\\s*${pixels}px`));
            assert.match(css, /data-copy-restricted=['"]true['"]/);
            writeFileSync(
                join(root, 'styles.css'),
                "@import '@miniextensions/sdk/react/readonly-portal-grid.css';\n"
            );
            const styles = await build({
                absWorkingDir: root,
                entryPoints: ['styles.css'],
                bundle: true,
                outfile: join(root, 'grid.css'),
                metafile: true,
            });
            await assertBrowserInputs(styles.metafile, root);
            assert(
                Object.keys(styles.metafile.inputs).some((name) =>
                    name.endsWith('/react/readonly-portal-grid.css')
                )
            );
            assert.equal(
                createHash('sha256')
                    .update(readFileSync(archivePath))
                    .digest('hex'),
                archiveSha256
            );
            completedProfile = {
                react,
                profiles: 2,
                tests: componentCases * 2,
                strictTypes: ['ESM', 'CJS', 'Bundler'],
                styles: 'owned table, controls and cell geometry',
                ...receipt,
            };
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        console.log(
            JSON.stringify({ ...completedProfile, cleanup: 'completed' })
        );
    }
    return { profiles, tests: profiles.reduce((total, profile) => total + profile.tests, 0), archiveSha256 };
}
