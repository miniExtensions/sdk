import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const consumer = `import {createElement} from 'react';
import {AttachmentPreview, type AttachmentPreviewProps, type AttachmentPreviewSource} from '@miniextensions/sdk/react';
import {isAttachmentPreviewImage, classifyAttachmentPreview} from '@miniextensions/sdk/ui';
const attachment: AttachmentPreviewSource = {url:'/local.pdf', filename:null, type:null};
const props: AttachmentPreviewProps = {attachment, labels:{attachments:'Archivos adjuntos', previewNotAvailable:'No preview'}};
createElement(AttachmentPreview, props);
isAttachmentPreviewImage(attachment); classifyAttachmentPreview(attachment);
// @ts-expect-error a label-only facet has no explicit media URL
createElement(AttachmentPreview, {attachment:{filename:'Only a label'}});
// @ts-expect-error complete preview has no injected native renderer
createElement(AttachmentPreview, {...props, renderNative:()=>null});
`;

export function checkAttachmentPreviewReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = resolve(archivePath);
    const parent = mkdtempSync(
        join(tmpdir(), 'sdk-attachment-preview-consumers-')
    );
    const profiles = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const root = mkdtempSync(join(parent, version.react + '-'));
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react: version.react,
                        'react-dom': version.react,
                        '@types/react': version.types,
                        '@types/react-dom': version.domTypes,
                        '@types/node': '22.20.5',
                    },
                })
            );
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: root,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 120000,
                });
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
            ]);
            for (const format of ['esm', 'cjs']) {
                const extension = format === 'esm' ? 'mts' : 'cts';
                writeFileSync(join(root, 'consumer.' + extension), consumer);
                run(process.execPath, [
                    typescriptBin,
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--noEmit',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    'consumer.' + extension,
                ]);
                const imports =
                    format === 'esm'
                        ? `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AttachmentPreview} from '@miniextensions/sdk/react';`
                        : `const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {AttachmentPreview}=require('@miniextensions/sdk/react');`;
                writeFileSync(
                    join(root, 'runtime.mjs'),
                    `import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);${imports}
const render=attachment=>renderToStaticMarkup(React.createElement(AttachmentPreview,{attachment}));
assert.match(render({url:'/photo.jpg'}),/<img/);
assert.match(render({url:'/audio',type:'audio/mpeg'}),/<audio[^>]*controls/);
assert.match(render({url:'/video',type:'video/mp4'}),/<video[^>]*controls/);
assert.match(render({url:'/file.pdf'}),/title="Attachments"/);
assert.match(render({url:'/file.PDF'}),/Preview Not Available/);
assert.ok(require.resolve('@miniextensions/sdk/react/attachment-preview.css'));
console.log(JSON.stringify({react:React.version,format:'${format}',ssr:true,explicitURL:true}));`
                );
                const result = JSON.parse(
                    run(process.execPath, [
                        ...(format === 'cjs'
                            ? ['--no-experimental-require-module']
                            : []),
                        'runtime.mjs',
                    ]).trim()
                );
                assert.equal(result.react, version.react);
                const module = readFileSync(
                    join(
                        root,
                        `node_modules/@miniextensions/sdk/dist/${format}/react/AttachmentPreview.js`
                    )
                );
                const packed = execFileSync('tar', [
                    '-xOf',
                    archivePath,
                    `package/dist/${format}/react/AttachmentPreview.js`,
                ]);
                assert.ok(module.equals(packed));
                profiles.push({
                    ...result,
                    strictTypes: true,
                    moduleSha256: createHash('sha256')
                        .update(module)
                        .digest('hex'),
                });
            }
        }
        return { profiles, cleanup: 'completed' };
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
}
