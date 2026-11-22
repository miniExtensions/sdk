import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

export const portalGalleryTypedConsumer = String.raw`
import {createElement} from 'react';
import {PortalGallery,resolvePortalGalleryColumns,type PortalGalleryProps,type PortalGalleryRow,type LinkedFinderAttachmentThumbnail} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/portal-gallery.css';
const entry:LinkedFinderAttachmentThumbnail={id:'file',thumbnailUrl:null,filename:'Admitted file.pdf'};
const rows:readonly PortalGalleryRow[]=[{key:'occurrence',recordId:'record',accessibleLabel:'Record',projection:{status:'loading',label:'Loading'}}];
const props:PortalGalleryProps={label:'Projects',content:{status:'rows',rows,emptyLabel:null},columns:resolvePortalGalleryColumns('6'),width:'fixed',reloading:{label:'Refreshing'},unlinkingRecordId:null,paging:{canRequestMore:true,showSpinner:false,requestLabel:'More',loadingLabel:'Loading',requestMore(){}}};
createElement(PortalGallery,props);void entry;
// @ts-expect-error controlled row collections are readonly
rows.push(rows[0]!);
// @ts-expect-error column caps stop at six
const badColumns:PortalGalleryProps={...props,columns:7};
// @ts-expect-error the complete card has no mandatory/native JSX slot
const slot:PortalGalleryProps={...props,renderCard:()=>null};
// @ts-expect-error the presenter grants no read/transport port
const reader:PortalGalleryProps={...props,queryRecords:async()=>[]};
// @ts-expect-error thumbnail descriptors are readonly
entry.thumbnailUrl='replacement';
void badColumns;void slot;void reader;
`;

/** Execute unchanged source assertions through installed public exports. */
export async function checkPortalGalleryReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = realpathSync(archivePath);
    const archiveSha256 = createHash('sha256')
        .update(readFileSync(archivePath))
        .digest('hex');
    const source = readFileSync(
        fileURLToPath(
            new URL('../test/reactPortalGallery.test.ts', import.meta.url)
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
    assert(source.includes("'../src/react/index.js'"));
    const profiles = [];
    for (const [react, types, domTypes] of [
        ['18.3.1', '18.3.12', '18.3.1'],
        ['19.2.0', '19.2.2', '19.2.2'],
    ]) {
        const root = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-portal-gallery-'))
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
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 120000,
                });
            for (const extension of ['mts', 'cts']) {
                writeFileSync(
                    join(root, `gallery.${extension}`),
                    portalGalleryTypedConsumer
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
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    `gallery.${extension}`,
                ]);
            }
            for (const format of ['esm', 'cjs']) {
                const extension = format === 'esm' ? 'mjs' : 'cjs';
                writeFileSync(
                    join(root, `gallery-fixture.${extension}`),
                    transformSync(fixture, {
                        loader: 'ts',
                        format,
                        target: 'es2022',
                    }).code
                );
                const installedSource = source
                    .replaceAll(
                        '../src/react/index.js',
                        '@miniextensions/sdk/react'
                    )
                    .replaceAll(
                        './fixtures/htmlPresentationFixture.js',
                        `./gallery-fixture.${extension}`
                    );
                assert(!installedSource.includes('../src/'));
                const testName = `gallery.${format}.test.${extension}`;
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
                assert.match(output, /# tests 13\b/);
                assert.match(output, /# pass 13\b/);
                assert.match(output, /# fail 0\b/);
                assert.match(output, /# skipped 0\b/);
                assert.match(output, /# cancelled 0\b/);
                profiles.push({
                    react,
                    format,
                    tests: 13,
                    failures: 0,
                    archiveSha256,
                    lockSha256: receipt.lockSha256,
                });
            }
            writeFileSync(
                join(root, 'styles.css'),
                "@import '@miniextensions/sdk/react/portal-gallery.css';\n"
            );
            const style = await build({
                absWorkingDir: root,
                entryPoints: ['styles.css'],
                bundle: true,
                outfile: join(root, 'gallery.css'),
                metafile: true,
            });
            await assertBrowserInputs(style.metafile, root);
            assert(
                Object.keys(style.metafile.inputs).some((path) =>
                    path.endsWith('/react/html-description.css')
                )
            );
            assert(
                Object.keys(style.metafile.inputs).some((path) =>
                    path.endsWith('/react/complete-linked-finder.css')
                )
            );
            const css = readFileSync(join(root, 'gallery.css'), 'utf8');
            assert(css.includes('mx-sdk-portal-gallery-grid'));
            assert(css.includes('200px'));
            assert(css.includes('mx-sdk-finder-card-primary-empty'));
            assert.equal(
                createHash('sha256')
                    .update(readFileSync(archivePath))
                    .digest('hex'),
                archiveSha256
            );
            completedProfile = {
                react,
                profiles: 2,
                tests: 26,
                strictTypes: ['ESM', 'CJS'],
                styles: 'shared card + HTML closure',
                ...receipt,
            };
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        console.log(
            JSON.stringify({ ...completedProfile, cleanup: 'completed' })
        );
    }
    return { profiles, tests: 52, archiveSha256 };
}
