import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { addAttachmentReviewAnswers } from './attachment-review-recipe-checks.mjs';

/** Optional local Chromium proof against the same installed/copied consumer. */
export async function checkNativeAttachmentPresentation({ consumer, bundle }) {
    const { chromium } = await import(
        pathToFileURL(process.env.SDK_ATTACHMENT_NATIVE_PLAYWRIGHT).href
    );
    const fixture = createReviewFixture('review-answers');
    const loaded = fixture.page();
    addAttachmentReviewAnswers(loaded);
    const html = readFileSync(join(consumer, 'index.html'), 'utf8').replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/g,
        '<script type="module" src="/main.js"></script>'
    );
    const server = createServer((request, response) => {
        if (request.url === '/main.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(readFileSync(bundle));
        } else if (request.url === '/styles.css') {
            response.setHeader('Content-Type', 'text/css');
            response.end(readFileSync(join(consumer, 'styles.css')));
        } else response.end(html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({
            executablePath: process.env.SDK_ATTACHMENT_NATIVE_CHROMIUM,
            headless: true,
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage();
        // Enable chooser interception before navigation/keyboard commands.
        const chooserEvents = [];
        page.on('filechooser', (event) => chooserEvents.push(event));
        const calls = [];
        await page.route('https://synthetic-sdk.invalid/**', async (route) => {
            const request = route.request();
            const operation = new URL(request.url()).searchParams.get('route');
            calls.push({ operation, input: request.postDataJSON() });
            assert(
                ['fetchExtensionForEndUser', 'saveForm'].includes(operation)
            );
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(
                    operation === 'fetchExtensionForEndUser'
                        ? loaded
                        : {
                              type: 'error',
                              formValidationErrors: [],
                              formErrors: {},
                          }
                ),
            });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('#api-origin').fill('https://synthetic-sdk.invalid');
        await page.locator('#share-id').fill('native_attachment_synthetic');
        await page
            .locator('#connection-form')
            .evaluate((form) => form.requestSubmit());
        const input = page.locator(
            'input[data-pending-field-id="fld_review_files"]'
        );
        await input.waitFor({ state: 'attached' });
        console.log(
            'Native chooser initial load busy:',
            await page.locator('#screen').getAttribute('aria-busy')
        );
        await page.waitForFunction(
            () =>
                document.querySelector('#screen').getAttribute('aria-busy') ===
                'false'
        );
        const wrapper = input.locator('..');
        const choose = wrapper.getByRole('button', {
            name: 'Choose a file',
            exact: true,
        });
        assert.equal(await input.isVisible(), false);
        assert.equal(await input.getAttribute('aria-hidden'), 'true');
        assert.equal(await input.getAttribute('tabindex'), '-1');
        const ax = JSON.stringify(await page.accessibility.snapshot());
        assert(ax.includes('Choose a file'));
        assert(!ax.includes('PRIVATE_STORED'));
        // Native Tab navigation, then Enter activates the actual browser chooser.
        await choose.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        assert.equal(
            await choose.evaluate((node) => document.activeElement === node),
            true
        );
        await input.evaluate((node) => {
            window.attachmentNativeClicks = { input: 0, button: 0 };
            node.addEventListener(
                'click',
                () => window.attachmentNativeClicks.input++
            );
            node.parentElement
                .querySelector('button')
                .addEventListener(
                    'click',
                    () => window.attachmentNativeClicks.button++
                );
        });
        let chooserEvent = page.waitForEvent('filechooser');
        await page.keyboard.press('Enter');
        let chooser;
        try {
            chooser = await chooserEvent;
        } catch (error) {
            console.log(
                'Native chooser diagnostic:',
                await page.evaluate(() => ({
                    clicks: window.attachmentNativeClicks,
                    active: document.activeElement?.textContent,
                    busy: document
                        .querySelector('#screen')
                        .getAttribute('aria-busy'),
                    inert: document.querySelector('.fields').inert,
                }))
            );
            throw error;
        }
        assert.equal(await input.evaluate((node) => node.files.length), 0);
        await chooser.setFiles([]); // empty completion; not an OS-dialog cancellation claim.
        assert.equal(
            await wrapper.getByRole('status').textContent(),
            'No file selected.'
        );
        chooserEvent = page.waitForEvent('filechooser');
        await choose.press('Enter');
        chooser = await chooserEvent;
        await chooser.setFiles({
            name: 'PRIVATE_PENDING_NAME.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('a'),
        });
        assert.equal(
            await wrapper.getByRole('status').textContent(),
            'File selected; upload or clear explicitly.'
        );
        chooserEvent = page.waitForEvent('filechooser');
        await choose.press('Enter');
        chooser = await chooserEvent;
        await chooser.setFiles({
            name: 'PRIVATE_REPLACEMENT.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('b'),
        });
        assert.equal(
            await input.evaluate((node) => node.files[0].name),
            'PRIVATE_REPLACEMENT.txt'
        );
        const dom = await wrapper.evaluate((node) => node.outerHTML);
        assert(!dom.includes('PRIVATE'));
        assert.equal(calls.length, 1);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.equal(await page.locator('dialog[open]').count(), 0);
        await page
            .getByRole('button', { name: 'Clear pending files', exact: true })
            .click();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.locator('dialog[open]').waitFor();
        assert(
            !(
                await page.locator('dialog').evaluate((node) => node.outerHTML)
            ).includes('PRIVATE')
        );
        await page
            .getByRole('button', { name: 'Confirm', exact: true })
            .click();
        await page.waitForFunction(
            () =>
                document.querySelector('#screen').getAttribute('aria-busy') ===
                'false'
        );
        assert.equal(chooserEvents.length, 3);
        assert.deepEqual(
            await page.evaluate(() => window.attachmentNativeClicks),
            { input: 3, button: 3 }
        );
        const saves = calls.filter((call) => call.operation === 'saveForm');
        assert.equal(saves.length, 1);
        assert.deepEqual(saves[0].input.formRecord, loaded.payload.formRecord);
        assert.deepEqual(saves[0].input.formFieldIdsWithUnsavedChanges, []);
        console.log(
            `Native attachment presentation: Chromium ${browser.version()}, installed starter keyboard/chooser, AX snapshot, empty completion/replacement, privacy and one synthetic validation Save passed; no OS cancellation or persistence claim`
        );
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
    }
}
