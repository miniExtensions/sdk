// node scripts/check-form-submit-another-browser.mjs <packed-sdk.tgz> <sha256>
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

const [archiveArg, expectedSha256] = process.argv.slice(2);
assert(
    archiveArg && /^[a-f0-9]{64}$/.test(expectedSha256 ?? ''),
    'Pass the SDK archive and SHA-256'
);
const archive = realpathSync(archiveArg);
const recordId = 'rec12345678901234';
const initial = `/record-survey/${recordId}?screen=success&recordIdToCopyFrom=recOld&prefill_Title=Keep&campaign=summer`;
const target = '/record-survey?prefill_Title=Keep&campaign=summer';
const fixture = `
import { createElement as h, StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
import { CompleteFormComposition } from '@miniextensions/sdk/react';
import { dispatchFormCompletionCommands, projectFormCompletion, projectFormCompletionNavigation } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/form-composition.css';
import '@miniextensions/sdk/react/form-completion.css';

const configuration = {
    afterFormSubmission: 'stay', successAction: true,
    successMessageCanCreateNewRecord: true, successMessageNewRecordText: 'Submit another',
};
const projection = projectFormCompletion({
    configuration, language: 'en', filteredValues: {}, unfilteredValues: {},
    fields: {}, linkedTableStates: {},
});
const events = { enters: [], submits: 0, saves: 0, intents: [] };
document.addEventListener('keydown', event => {
    if (event.key === 'Enter') events.enters.push(event.isTrusted);
}, true);
document.addEventListener('submit', () => events.submits++, true);
createRoot(document.querySelector('main')).render(h(StrictMode, null, h(CompleteFormComposition, {
    formId: 'root-form', items: [], onSubmit: () => events.saves++,
    completion: {
        configuration, projection, canSubmit: true,
        onCommand(intent) {
            events.intents.push(intent);
            const commands = projectFormCompletionNavigation({
                currentURL: location.href, inIframe: window !== window.top,
                recordId: '${recordId}', command: intent,
            });
            return dispatchFormCompletionCommands(commands, {
                isCurrent: () => true,
                dispatch(command) {
                    if (command.type !== 'navigate' || command.route !== 'self' ||
                        new URL(command.url).origin !== location.origin) throw new Error('Unexpected navigation');
                    console.info('FORM_PROOF ' + JSON.stringify({ react: version, events, command }));
                    location.href = command.url;
                },
            });
        },
    },
})));`;

async function check(browser, react) {
    const directory = mkdtempSync(
        join(realpathSync(tmpdir()), 'sdk-form-route-')
    );
    let server;
    let context;
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@miniextensions/sdk': `file:${archive}`,
                    react,
                    'react-dom': react,
                },
            })
        );
        const installation = installAgeQualifiedConsumer({
            directory,
            args: ['install'],
        });
        assert.equal(installation.archiveSha256, expectedSha256);
        writeFileSync(join(directory, 'form.mjs'), fixture);
        const bundle = await build({
            absWorkingDir: directory,
            entryPoints: ['form.mjs'],
            outfile: 'form.js',
            bundle: true,
            write: false,
            metafile: true,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        await assertBrowserInputs(bundle.metafile, directory);
        for (const member of [
            'forms/completion.js',
            'react/CompleteFormComposition.js',
            'react/CompleteFormCompletion.js',
        ]) {
            assert(
                Object.keys(bundle.metafile.inputs).includes(
                    'node_modules/@miniextensions/sdk/dist/esm/' + member
                ),
                member
            );
        }
        const html =
            '<!doctype html><html lang="en"><meta charset="utf-8"><title>Form completion</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/form.css"><main></main><script defer src="/form.js"></script></html>';
        const assets = new Map([
            [initial, ['text/html', html]],
            [
                target,
                [
                    'text/html',
                    '<!doctype html><title>New Form</title><h1>New Form</h1><div id="section"></div>',
                ],
            ],
            ['/favicon.ico', ['image/x-icon', '']],
            ...bundle.outputFiles.map((file) => {
                const css = file.path.endsWith('.css');
                return [
                    css ? '/form.css' : '/form.js',
                    [css ? 'text/css' : 'text/javascript', file.contents],
                ];
            }),
        ]);
        const documents = [];
        const receipts = [];
        const unexpected = [];
        const errors = [];
        server = createServer((request, response) => {
            if (request.headers['sec-fetch-dest'] === 'document') {
                documents.push([
                    request.method,
                    request.url,
                    request.headers['sec-fetch-mode'],
                ]);
            }
            const asset = request.method === 'GET' && assets.get(request.url);
            if (!asset) return response.writeHead(404).end();
            response
                .writeHead(200, {
                    'Content-Type': asset[0],
                    'Cache-Control': 'no-store',
                    'Content-Security-Policy':
                        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'",
                })
                .end(asset[1]);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', (route) => {
            const request = route.request();
            if (
                request.method() === 'GET' &&
                request.url().startsWith(origin + '/') &&
                assets.has(request.url().slice(origin.length))
            )
                return route.continue();
            unexpected.push([request.method(), request.url()]);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('console', (message) => {
            if (message.text().startsWith('FORM_PROOF '))
                receipts.push(JSON.parse(message.text().slice(11)));
        });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin + initial + '#section');
        const button = page.getByRole('button', {
            name: 'Submit another',
            exact: true,
        });
        assert.equal(await button.getAttribute('type'), 'button');
        await button.focus();
        assert.equal(
            await button.evaluate(
                (element) => document.activeElement === element
            ),
            true
        );
        assert.deepEqual(receipts, []);
        const url = origin + target + '#section';
        await Promise.all([page.waitForURL(url), page.keyboard.press('Enter')]);
        await page
            .getByRole('heading', { name: 'New Form', exact: true })
            .waitFor();
        assert.equal(await page.evaluate(() => window === window.top), true);
        assert.deepEqual(receipts, [
            {
                react,
                events: {
                    enters: [true],
                    submits: 0,
                    saves: 0,
                    intents: ['submit_another_form'],
                },
                command: { type: 'navigate', route: 'self', url },
            },
        ]);
        assert.deepEqual(documents, [
            ['GET', initial, 'navigate'],
            ['GET', target, 'navigate'],
        ]);
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        return { react, documents, ...receipts[0].events };
    } finally {
        try {
            await context?.close();
        } finally {
            try {
                if (server?.listening)
                    await new Promise((yes, no) =>
                        server.close((error) => (error ? no(error) : yes()))
                    );
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    }
}

const browser = await chromium.launch({
    channel: 'chrome',
    chromiumSandbox: true,
});
try {
    const profiles = [];
    for (const react of ['18.3.1', '19.2.0'])
        profiles.push(await check(browser, react));
    console.log(
        JSON.stringify({
            archiveSha256: expectedSha256,
            chrome: browser.version(),
            profiles,
        })
    );
} finally {
    try {
        await browser.close();
    } finally {
        await stop();
    }
}
