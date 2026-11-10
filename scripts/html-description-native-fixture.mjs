import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
    htmlDescriptionBrowserSource,
    htmlDescriptionBrowserStyle,
    htmlDescriptionBrowserImagePath,
    htmlDescriptionBrowserImageSource,
    htmlDescriptionEditorReferenceBrowserSource,
    htmlDescriptionEditorReferenceBrowserStyle,
    prepareHTMLDescriptionEditorReference,
} from './html-description-consumer-checks.mjs';

const within = (root, path) => {
    const part = relative(root, path);
    return part === '' || (!part.startsWith('..') && !isAbsolute(part));
};

function packageRoot(entry) {
    for (let path = dirname(entry); ; path = dirname(path)) {
        try {
            const manifest = JSON.parse(
                readFileSync(join(path, 'package.json'))
            );
            if (manifest.name === '@miniextensions/sdk')
                return realpathSync(path);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        assert.notEqual(
            dirname(path),
            path,
            'Installed SDK package root missing'
        );
    }
}

// Two genuine installed packages are needed only for the sibling-editor check.
// pnpm uses canonical virtual-store paths, so validate those paths directly
// rather than rewriting metadata to look like npm's flat node_modules layout.
function recordInputs({
    metafile,
    directory,
    candidate,
    reference,
    archive,
    regular,
    hash,
}) {
    directory = realpathSync(directory);
    const inputs = [];
    let candidateInputs = 0;
    for (const name of Object.keys(metafile.inputs)) {
        assert(!name.startsWith('node:'), 'Node built-in in browser input');
        assert(
            !/(^|[/\\])jsdom(?:@|[/\\])/.test(name),
            'Node parser in browser input'
        );
        const path = realpathSync(resolve(directory, name));
        assert(
            within(directory, path),
            'Browser input escapes its clean consumer'
        );
        const bytes = regular(path);
        const item = {
            path: relative(directory, path),
            sha256: hash(bytes),
            bytes: bytes.length,
        };
        if (within(candidate, path)) {
            assert(
                within(join(candidate, 'dist'), path),
                'Candidate browser imported SDK source'
            );
            const member =
                'package/' + relative(candidate, path).replaceAll('\\', '/');
            assert.deepEqual(
                bytes,
                execFileSync('tar', ['-xOf', archive, member])
            );
            item.archiveMember = member;
            candidateInputs++;
        }
        if (reference && within(reference, path)) {
            assert(
                within(join(reference, 'dist'), path),
                'Reference browser imported outside its built SDK dist'
            );
            item.referencePackagePath = relative(reference, path);
        }
        inputs.push(item);
    }
    assert(candidateInputs > 0, 'Candidate public SDK dist was not bundled');
    assert(
        inputs.some(({ path }) =>
            path.endsWith('/react/html/htmlPurifier.browser.js')
        )
    );
    assert(
        !inputs.some(({ path }) => path.endsWith('/react/html/htmlPurifier.js'))
    );
    return inputs;
}

export async function prepareHTMLDescriptionNativeFixtures({
    temporary,
    output,
    archive,
    installed,
    allowed,
    report,
    nativeReactVersion,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    const consumerRequire = createRequire(join(temporary, 'package.json'));
    const cssPath = realpathSync(
        consumerRequire.resolve(
            '@miniextensions/sdk/react/html-description.css'
        )
    );
    assert(within(installed, cssPath));
    const css = regular(cssPath);
    const cssMember =
        'package/' + relative(installed, cssPath).replaceAll('\\', '/');
    assert.deepEqual(css, execFileSync('tar', ['-xOf', archive, cssMember]));
    const entry = join(temporary, 'html-description.mjs');
    writeFileSync(entry, htmlDescriptionBrowserSource);
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        write: false,
        outfile: join(temporary, 'html-description.js'),
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const inputs = recordInputs({
        metafile: bundle.metafile,
        directory: temporary,
        candidate: installed,
        archive,
        regular,
        hash,
    });
    const code = bundle.outputFiles[0].contents;
    report.htmlDescription = {
        sourceSha256: hash(htmlDescriptionBrowserSource),
        fixtureCssSha256: hash(htmlDescriptionBrowserStyle),
        packagedCssSha256: hash(css),
        packagedCssMember: cssMember,
        bundleSha256: hash(code),
        bundleInputs: inputs,
        ownedImageSha256: hash(htmlDescriptionBrowserImageSource),
    };
    allowed.set('/html-description.js', code);
    allowed.set('/html-description.css', css);
    allowed.set(
        '/html-description-fixture.css',
        Buffer.from(htmlDescriptionBrowserStyle)
    );
    allowed.set(
        htmlDescriptionBrowserImagePath,
        Buffer.from(htmlDescriptionBrowserImageSource)
    );
    allowed.set(
        '/html-description.html',
        Buffer.from(
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Standalone complete HTML descriptions</title><link rel="stylesheet" href="/html-description.css"><link rel="stylesheet" href="/html-description-fixture.css"></head><body><div id="root"></div><script type="module" src="/html-description.js"></script></body></html>`
        )
    );

    // The HTML component itself runs in both React matrices. Its distinct
    // immutable sibling-editor composition runs once, on the actual native
    // host's React 18 version, without a second reference build in React 19.
    const referenceEnabled =
        process.env.CI === 'true' && nativeReactVersion === '18.3.1';
    report.htmlEditorReference = {
        status: 'not-run',
        reason: 'Dedicated CI React 18 sibling-editor check; not ordinary component or hosted acceptance',
    };
    if (referenceEnabled) {
        const directory = join(temporary, 'html-editor-reference');
        mkdirSync(directory);
        const preparation = prepareHTMLDescriptionEditorReference({
            archivePath: archive,
            directory,
            evidenceDirectory: output,
        });
        const referenceRequire = createRequire(join(directory, 'package.json'));
        const candidate = packageRoot(preparation.htmlEntry);
        const reference = packageRoot(preparation.editorEntry);
        const referenceCSS = regular(realpathSync(preparation.editorCSS));
        const secondCSS = regular(
            realpathSync(
                referenceRequire.resolve(
                    '@miniextensions/sdk/react/html-description.css'
                )
            )
        );
        assert.deepEqual(
            secondCSS,
            css,
            'Reference consumer must use the same tested candidate stylesheet'
        );
        const referenceEntry = join(directory, 'html-editor-reference.mjs');
        writeFileSync(
            referenceEntry,
            htmlDescriptionEditorReferenceBrowserSource
        );
        const referenceBundle = await build({
            absWorkingDir: directory,
            entryPoints: [referenceEntry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            splitting: false,
            write: false,
            outfile: join(directory, 'html-editor-reference.js'),
            metafile: true,
            legalComments: 'none',
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        const referenceInputs = recordInputs({
            metafile: referenceBundle.metafile,
            directory,
            candidate,
            reference,
            archive,
            regular,
            hash,
        });
        assert(
            referenceInputs.some((item) =>
                item.referencePackagePath?.endsWith(
                    '/CompleteRichTextEditor.js'
                )
            )
        );
        const referenceCode = referenceBundle.outputFiles[0].contents;
        report.htmlEditorReference = {
            status: 'prepared',
            preparation,
            sourceSha256: hash(htmlDescriptionEditorReferenceBrowserSource),
            fixtureCssSha256: hash(htmlDescriptionEditorReferenceBrowserStyle),
            referenceCssSha256: hash(referenceCSS),
            candidateCssSha256: hash(css),
            bundleSha256: hash(referenceCode),
            bundleInputs: referenceInputs,
            scope: 'Real immutable public sibling editor plus candidate HTML; stylesheet coexistence, not a combined SDK or One product qualification',
        };
        allowed.set('/html-editor-reference.js', referenceCode);
        allowed.set('/html-editor-reference.css', referenceCSS);
        allowed.set(
            '/html-editor-reference-fixture.css',
            Buffer.from(htmlDescriptionEditorReferenceBrowserStyle)
        );
        allowed.set(
            '/html-editor-reference.html',
            Buffer.from(
                `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Real editor and HTML stylesheet coexistence</title><link rel="stylesheet" href="/html-editor-reference.css"><link rel="stylesheet" href="/html-editor-reference-fixture.css"></head><body><div id="root"></div><script type="module" src="/html-editor-reference.js"></script></body></html>`
            )
        );
    }
    return { referenceEnabled };
}
