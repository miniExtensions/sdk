import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
import {
    multipleAttachmentsLoadedFixture,
    multipleAttachmentsSaveOptions,
} from './multiple-attachments-consumer-checks.mjs';
import {
    heldRemoveCases,
    heldRemoveExpected,
    heldRemoveValues,
    mountHeldRemoveFixture,
} from './multiple-attachments-held-remove-fixture.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

export async function checkMultipleAttachmentsHeldRemoveBrowser({
    browser,
    consumer,
    evidence,
}) {
    const filename = 'multiple-attachments-held-remove-host.mjs';
    writeFileSync(
        join(consumer, filename),
        `
import {createElement as h} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {createMiniExtensionsClient} from '@miniextensions/sdk';
import {createFormFieldBindings, RecoveryJournal} from '@miniextensions/sdk/forms';
import {createFormFieldRendererHost} from '@miniextensions/sdk/ui';
import {FieldRenderer, renderMultipleAttachmentsField} from '@miniextensions/sdk/react';
const mount = ${mountHeldRemoveFixture.toString()};
const events = [];
for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup']) {
    document.addEventListener(type, event => {
        if (event.target.matches('button[data-attachment-row]')) {
            events.push([type, event.isTrusted]);
        }
    }, true);
}
window.heldRemove = {
    events,
    mount(values, newHost) {
        let probe;
        flushSync(() => {
            probe = mount({ h, root: createRoot(document.querySelector('main')),
                createMiniExtensionsClient, createFormFieldBindings, RecoveryJournal,
                createFormFieldRendererHost, FieldRenderer, renderMultipleAttachmentsField,
                loaded: ${JSON.stringify(multipleAttachmentsLoadedFixture().loaded)},
                saveOptions: ${JSON.stringify(multipleAttachmentsSaveOptions)}, values, newHost });
        });
        this.replace = () => flushSync(() => probe.replace());
        this.snapshot = probe.snapshot;
        this.dispose = probe.dispose;
    },
};
`
    );
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: [filename],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        metafile: true,
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    const server = createServer((request, response) => {
        response.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'none'"
        );
        if (request.url === '/host.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(bundle.outputFiles[0].contents);
        } else if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(
                '<!doctype html><html lang="en"><meta charset="utf-8"><title>Held Remove</title><style>li{display:grid;grid-template-columns:220px max-content}</style><main></main><script type="module" src="/host.js"></script></html>'
            );
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    const external = [];
    const errors = [];
    evidence.cases = [];
    let context;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.origin === origin) return route.continue();
            external.push(url.origin);
            return route.abort();
        });
        for (const options of heldRemoveCases) {
            const values = heldRemoveValues(options);
            const test = { ...options, status: 'running' };
            evidence.cases.push(test);
            const page = await context.newPage();
            try {
                page.on('pageerror', (error) => errors.push(error.message));
                await page.goto(origin);
                await page.evaluate(
                    ({ values, newHost }) =>
                        window.heldRemove.mount(values, newHost),
                    { values, newHost: options.newHost }
                );
                const button = page.getByRole('button', {
                    name: 'Remove attachment 1',
                    exact: true,
                });
                const check = async (phase) =>
                    assert.deepEqual(
                        await page.evaluate(() => window.heldRemove.snapshot()),
                        heldRemoveExpected(options, values, phase)
                    );
                const press = async () => {
                    if (options.gesture === 'Space') {
                        await button.focus();
                        await page.keyboard.down('Space');
                    } else {
                        await button.hover();
                        await page.mouse.down();
                    }
                };
                const release = () =>
                    options.gesture === 'Space'
                        ? page.keyboard.up('Space')
                        : page.mouse.up();
                await check('original');
                await press();
                await page.evaluate(() => window.heldRemove.replace());
                await check('replacement');
                assert.equal(
                    await button.locator('..').locator('span').textContent(),
                    values.replacement.filename
                );
                assert(
                    await button.evaluate(
                        (node) => document.activeElement === node
                    )
                );
                await release();
                await check('replacement');
                await press();
                await release();
                await check('fresh');
                assert(
                    await button.evaluate(
                        (node) => document.activeElement === node
                    )
                );
                const events = await page.evaluate(
                    () => window.heldRemove.events
                );
                const [down, up] =
                    options.gesture === 'Space'
                        ? ['keydown', 'keyup']
                        : ['pointerdown', 'pointerup'];
                assert.deepEqual(events, [
                    [down, true],
                    [up, true],
                    [down, true],
                    [up, true],
                ]);
                test.status = 'passed';
            } catch (error) {
                test.status = 'failed';
                throw error;
            } finally {
                try {
                    await page.evaluate(() => window.heldRemove?.dispose?.());
                } finally {
                    await page.close();
                }
            }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
    } finally {
        try {
            await context?.close();
        } finally {
            if (server.listening)
                await new Promise((resolve, reject) => {
                    server.close((error) => (error ? reject(error) : resolve()));
                });
        }
    }
}
