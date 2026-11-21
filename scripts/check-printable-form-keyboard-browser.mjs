import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    lstatSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

const done = 'Acknowledge fixture print';
const text = {
    A: {
        title: 'Fixture document A',
        readonly: 'Readonly marker A',
        editable: 'Editable marker A',
    },
    B: {
        title: 'Fixture document B',
        readonly: 'Readonly marker B',
        editable: 'Editable marker B',
    },
};
const selectors = {
    frame: 'iframe[data-mx-sdk-print-frame]',
    source: '[data-mx-sdk-print-source]',
    job: '[data-mx-sdk-print-job]',
};

const entry = [
    "import { createElement as h, useState } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { PrintableForm, createBrowserPrintableFormEngine } from '@miniextensions/sdk/react';",
    "import { getDocumentPrintableFormAdmission } from '@miniextensions/sdk/ui';",
    "import '@miniextensions/sdk/react/printable-form.css';",
    'const done = ' + JSON.stringify(done) + ';',
    'const text = ' + JSON.stringify(text) + ';',
    'const selectors = ' + JSON.stringify(selectors) + ';',
    '(' + printFixture.toString() + ')();',
].join('\n');

function printFixture() {
    const assertFixture = (pass, message) => {
        if (!pass) throw new Error(message);
    };
    const observed = {
        captures: [],
        prints: [],
        keys: [],
        submits: 0,
        writes: 0,
    };
    const admission = getDocumentPrintableFormAdmission(document);
    const labels = {
        print: 'Print fixture Form',
        preparing: 'Preparing fixture document',
        cancel: 'Cancel fixture preparation',
        invoked: 'Fixture print boundary invoked',
        unknown: 'Fixture print state unknown',
        failed: 'Fixture preparation failed',
        done,
    };
    const browserEngine = createBrowserPrintableFormEngine(document, labels);
    const engine = {
        async prepare(documentDto, context) {
            const prepared = await browserEngine.prepare(documentDto, context);
            try {
                const frames = document.querySelectorAll(selectors.frame);
                assertFixture(
                    frames.length === 1,
                    'Expected one owned print frame'
                );
                const frame = frames[0];
                const owner = frame.contentWindow;
                const content = frame.contentDocument;
                assertFixture(
                    owner && content,
                    'Missing same-origin print frame'
                );
                const recordPrint = () =>
                    observed.prints.push({
                        title: content.title,
                        body: content.body.textContent,
                        editableControls: content.querySelectorAll(
                            'input,textarea,select,[contenteditable=true]'
                        ).length,
                        visibleSource: Boolean(
                            content.querySelector(
                                selectors.source + ':not([inert])'
                            )
                        ),
                    });
                Object.defineProperty(owner, 'print', {
                    configurable: true,
                    value: recordPrint,
                });
                const verifyBoundary = () =>
                    assertFixture(
                        frame.isConnected &&
                            frame.contentWindow === owner &&
                            owner.print === recordPrint,
                        'Refusing to enter a print boundary outside the owned fixture'
                    );
                return {
                    invoke(atBoundary) {
                        verifyBoundary();
                        return prepared.invoke((browserPrint) =>
                            atBoundary(() => {
                                verifyBoundary();
                                browserPrint();
                            })
                        );
                    },
                    dispose: () => prepared.dispose(),
                };
            } catch (error) {
                await prepared.dispose();
                throw error;
            }
        },
    };
    const forms = Object.fromEntries(
        Object.entries(text).map(([id, marker]) => {
            let current = true;
            const scope = Object.freeze({
                owner: Object.freeze({}),
                revision: Object.freeze({}),
            });
            const lease = Object.freeze({});
            const source = {
                readAuthority: () =>
                    current
                        ? {
                              scope,
                              explicitAllowed: true,
                              keyboardAllowed: true,
                              keyboardLease: lease,
                          }
                        : null,
                isCurrent: (expected) =>
                    current &&
                    expected.owner === scope.owner &&
                    expected.revision === scope.revision,
                capture(expected) {
                    assertFixture(
                        source.isCurrent(expected),
                        'Retired fixture capture'
                    );
                    observed.captures.push(id);
                    return {
                        status: 'accepted',
                        document: {
                            language: 'en',
                            title: marker.title,
                            fields: [
                                {
                                    key: 'name',
                                    fieldName: 'Name',
                                    title: 'Name',
                                    semanticTitle: 'Name',
                                    showTitle: true,
                                    required: false,
                                    sameRow: false,
                                    enableSideBySideOnMobile: false,
                                    facet: {
                                        kind: 'text',
                                        value: marker.readonly,
                                        emptyLabel: 'None',
                                    },
                                },
                            ],
                        },
                    };
                },
            };
            return [
                id,
                {
                    lease,
                    source,
                    retire: () => {
                        current = false;
                    },
                },
            ];
        })
    );

    // The SDK sees the event first at document bubble. Suppress any native
    // browser shortcut only after recording the SDK's prevention decision.
    function observeKey(event) {
        const printKey = event.ctrlKey && event.key === 'p';
        if (!printKey && event.key !== 'x') return;
        observed.keys.push({
            key: event.key,
            ctrl: event.ctrlKey,
            trusted: event.isTrusted,
            sdkPrevented: event.defaultPrevented,
        });
        if (printKey) event.preventDefault();
    }
    window.addEventListener('keydown', observeKey);
    assertFixture(
        admission.setKeyboardOwner(null, forms.A.lease),
        'Could not admit Form A'
    );
    const root = createRoot(document.getElementById('root'));
    function Forms() {
        const [aMounted, setAMounted] = useState(true);
        window.transferPrintLease = () => {
            assertFixture(
                admission.setKeyboardOwner(forms.A.lease, forms.B.lease),
                'Could not transfer keyboard lease'
            );
            forms.A.retire();
            setAMounted(false);
        };
        return ['A', 'B']
            .filter((id) => id !== 'A' || aMounted)
            .map((id) =>
                h(
                    'form',
                    {
                        key: id,
                        id: 'form-' + id,
                        onSubmit(event) {
                            event.preventDefault();
                            observed.submits++;
                        },
                    },
                    h('input', {
                        'aria-label': 'Editable Form ' + id,
                        defaultValue: text[id].editable,
                        onInput() {
                            observed.writes++;
                        },
                    }),
                    h(PrintableForm, {
                        source: forms[id].source,
                        ownerDocument: document,
                        admission,
                        engine,
                        labels,
                    })
                )
            );
    }
    window.printFixture = {
        observed,
        currentOwner: () =>
            ['A', 'B'].find(
                (id) => forms[id].lease === admission.keyboardOwner()
            ) ?? null,
        unmount() {
            assertFixture(
                admission.setKeyboardOwner(forms.B.lease, null),
                'Could not release Form B'
            );
            forms.B.retire();
            root.unmount();
        },
        stopObserving() {
            window.removeEventListener('keydown', observeKey);
        },
    };
    root.render(h(Forms));
}

function regularFile(path) {
    const absolute = resolve(path);
    assert.equal(
        realpathSync(absolute),
        absolute,
        'Refuse redirected fixture input'
    );
    assert(lstatSync(absolute).isFile());
    return absolute;
}

function verifiedKit(archive, receipt) {
    const kit = JSON.parse(readFileSync(regularFile(receipt), 'utf8'));
    const bytes = readFileSync(regularFile(archive));
    assert.equal(kit.schemaVersion, 1);
    assert.equal(kit.verification.outcome, 'passed');
    assert.equal(kit.ci.repository, 'miniExtensions/sdk');
    assert.equal(kit.ci.workflowSha, kit.source.commit);
    assert.equal(kit.package.name, '@miniextensions/sdk');
    assert.equal(kit.package.filename, basename(archive));
    assert.equal(kit.package.bytes, bytes.length);
    assert.equal(
        kit.package.sha256,
        createHash('sha256').update(bytes).digest('hex')
    );
    assert.equal(
        kit.package.integrity,
        'sha512-' + createHash('sha512').update(bytes).digest('base64')
    );
    return kit;
}

async function checkGestures(page) {
    const read = () =>
        page.evaluate(() => ({
            ...window.printFixture.observed,
            owner: window.printFixture.currentOwner(),
        }));
    const resources = Object.values(selectors).join(',');
    const waitForCleanup = () =>
        page.locator(resources).waitFor({ state: 'detached' });
    async function key(gesture) {
        const target = page.locator('#keyboard-target');
        await target.focus();
        assert(
            await target.evaluate(
                (element) => element === document.activeElement
            )
        );
        await page.keyboard.press(gesture);
    }
    async function waitForPrint(count) {
        await page.waitForFunction(
            (count) => window.printFixture.observed.prints.length === count,
            count
        );
    }
    function checkDocument(document, id) {
        const sibling = id === 'A' ? 'B' : 'A';
        assert.equal(document.title, text[id].title);
        assert(document.body.includes(text[id].readonly));
        assert(!document.body.includes(text[sibling].readonly));
        assert(
            Object.values(text).every(
                (marker) => !document.body.includes(marker.editable)
            )
        );
        assert.equal(document.editableControls, 0);
        assert(document.visibleSource);
    }

    await page.waitForFunction(
        () =>
            [
                ...document.querySelectorAll(
                    'form .mx-sdk-print-controls button'
                ),
            ].filter((button) => !button.disabled).length === 2
    );
    assert.equal((await read()).owner, 'A');
    await key('x');
    assert.deepEqual((await read()).captures, []);
    assert.deepEqual((await read()).prints, []);
    await key('Control+p');
    await waitForPrint(1);
    let state = await read();
    assert.deepEqual(state.captures, ['A']);
    checkDocument(state.prints[0], 'A');
    const frame = page.locator(selectors.frame);
    assert.equal(await frame.count(), 1);
    const doneButton = page.getByRole('button', { name: done, exact: true });
    await doneButton.waitFor();
    await key('Control+p');
    state = await read();
    assert.deepEqual(state.captures, ['A']);
    assert.equal(state.prints.length, 1);
    assert.equal(await frame.count(), 1);
    await doneButton.click();
    await waitForCleanup();

    await page.evaluate(() => window.transferPrintLease());
    await page.locator('#form-A').waitFor({ state: 'detached' });
    assert.equal((await read()).owner, 'B');
    await key('Control+p');
    await waitForPrint(2);
    state = await read();
    assert.deepEqual(state.captures, ['A', 'B']);
    checkDocument(state.prints[1], 'B');
    assert.equal(await frame.count(), 1);
    await doneButton.click();
    await waitForCleanup();

    await page.evaluate(() => window.printFixture.unmount());
    assert.equal(await page.locator('#root form').count(), 0);
    await key('Control+p');
    state = await read();
    assert.equal(state.owner, null);
    assert.deepEqual(state.captures, ['A', 'B']);
    assert.equal(state.prints.length, 2);
    assert.deepEqual(state.keys, [
        { key: 'x', ctrl: false, trusted: true, sdkPrevented: false },
        { key: 'p', ctrl: true, trusted: true, sdkPrevented: true },
        { key: 'p', ctrl: true, trusted: true, sdkPrevented: true },
        { key: 'p', ctrl: true, trusted: true, sdkPrevented: true },
        { key: 'p', ctrl: true, trusted: true, sdkPrevented: false },
    ]);
    assert.equal(state.writes, 0);
    assert.equal(state.submits, 0);
    await waitForCleanup();
    await page.evaluate(() => window.printFixture.stopObserving());
    return state;
}

async function runProfile(browser, archive, react) {
    const directory = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-print-consumer-'))
    );
    let context, server;
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
                },
            })
        );
        const install = installAgeQualifiedConsumer({
            directory,
            args: ['install'],
        });
        const require = createRequire(join(directory, 'package.json'));
        const reactDom = require('react-dom/package.json').version;
        assert.equal(require('react/package.json').version, react);
        assert.equal(reactDom, react);
        writeFileSync(join(directory, 'fixture.mjs'), entry);
        const bundle = await build({
            absWorkingDir: directory,
            entryPoints: ['fixture.mjs'],
            outfile: 'app.js',
            bundle: true,
            write: false,
            metafile: true,
            logLevel: 'silent',
        });
        await assertBrowserInputs(bundle.metafile, directory);
        const css = bundle.outputFiles.find(
            (file) => basename(file.path) === 'app.css'
        )?.text;
        const script = bundle.outputFiles.find(
            (file) => basename(file.path) === 'app.js'
        )?.contents;
        assert(css && script && !/<\/style/i.test(css));
        // The stock engine clones styles into its iframe. Inline the shipped CSS
        // so that the actual preparation never needs another network request.
        const html =
            '<!doctype html><html lang="en"><meta charset="utf-8">' +
            '<link rel="icon" href="data:,"><style>' +
            css +
            '</style>' +
            '<button id="keyboard-target" type="button">Fixture keyboard target</button>' +
            '<div id="root"></div><script defer src="/app.js"></script>';
        const assets = new Map([
            ['/', ['text/html; charset=utf-8', html]],
            ['/app.js', ['text/javascript', script]],
        ]);
        server = createServer((request, response) => {
            const asset = request.method === 'GET' && assets.get(request.url);
            if (!asset) return response.writeHead(404).end();
            response
                .writeHead(200, {
                    'Content-Type': asset[0],
                    'Cache-Control': 'no-store',
                    'Content-Security-Policy':
                        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:; form-action 'none'; base-uri 'self'",
                })
                .end(asset[1]);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const origin = 'http://127.0.0.1:' + server.address().port;
        context = await browser.newContext({
            serviceWorkers: 'block',
            viewport: { width: 900, height: 540 },
        });
        const requests = [],
            errors = [];
        let loading = true;
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                loading &&
                request.method() === 'GET' &&
                url.origin === origin &&
                assets.has(url.pathname)
            )
                return route.continue();
            requests.push({ method: request.method(), path: url.pathname });
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        loading = false;
        const state = await checkGestures(page);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        return {
            react,
            reactDom,
            install,
            ...state,
            requests,
            errors,
            remainingPrintResources: 0,
        };
    } finally {
        try {
            if (context) await context.close();
        } finally {
            try {
                if (server?.listening) {
                    const closed = once(server, 'close');
                    server.close();
                    await closed;
                }
            } finally {
                rmSync(directory, { recursive: true });
            }
        }
    }
}

const { values } = parseArgs({
    options: {
        archive: { type: 'string' },
        receipt: { type: 'string' },
        chromium: { type: 'string' },
    },
});
assert(
    values.archive && values.receipt && values.chromium,
    'Pass --archive, --receipt and --chromium'
);
const kit = verifiedKit(values.archive, values.receipt);
const sourceSha256 = createHash('sha256')
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex');
const browser = await chromium.launch({
    executablePath: regularFile(values.chromium),
    headless: true,
    chromiumSandbox: true,
});
const profiles = [];
try {
    for (const react of ['18.3.1', '19.2.0'])
        profiles.push(
            await runProfile(browser, regularFile(values.archive), react)
        );
    verifiedKit(values.archive, values.receipt);
} finally {
    try {
        await browser.close();
    } finally {
        await stop();
    }
}
console.log(
    JSON.stringify(
        {
            sourceSha256,
            kit: kit.source,
            package: kit.package,
            ci: kit.ci,
            browser: browser.version(),
            profiles,
            finishedAt: new Date().toISOString(),
            cleanup: 'completed',
        },
        null,
        2
    )
);
