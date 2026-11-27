import assert from 'node:assert/strict';
import { join } from 'node:path';

const guideUrl = 'https://example.test/welcome-guide';
const guideDocument = `<!doctype html><meta charset="utf-8"><title>Welcome guide</title>
<button type="button" id="play">Play guide</button>
<script>
window.guideClicks = [];
document.querySelector('#play').addEventListener('click', (event) => {
    window.guideClicks.push({ trusted: event.isTrusted, detail: event.detail });
});
</script>`;

/** Exercise the installed SDK's Welcome dialog in an isolated host document. */
export async function checkPortalWelcomeGuideFocus({
    browser,
    origin,
    evidence,
    output,
    label,
}) {
    const context = await browser.newContext({
        viewport: { width: 375, height: 780 },
        serviceWorkers: 'block',
    });
    Object.assign(evidence, {
        status: 'running',
        guideRequests: 0,
        unexpectedRequests: [],
        pageErrors: [],
        steps: {},
        textOnly: {},
    });
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                request.method() === 'GET' &&
                url.href === guideUrl &&
                request.resourceType() === 'document'
            ) {
                evidence.guideRequests++;
                return route.fulfill({
                    contentType: 'text/html',
                    headers: {
                        'Content-Security-Policy':
                            "default-src 'none'; script-src 'unsafe-inline'; form-action 'none'",
                    },
                    body: guideDocument,
                });
            }
            if (
                request.method() === 'GET' &&
                url.origin === origin &&
                ['/', '/main.js', '/main.css', '/favicon.ico'].includes(
                    url.pathname
                )
            )
                return route.continue();
            evidence.unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        const effects = (page) =>
            page.evaluate(() => ({
                intents: window.proof.intents.map(({ type }) => type),
                dismissals: [...window.proof.dismissals],
                storage: window.proof.storage.length,
                reads: window.proof.reads.length,
                activations: window.proof.activations.length,
            }));
        async function openWelcome(id, title, messageHtml) {
            const page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            await page.goto(origin);
            await page.getByRole('button', { name: 'Record action' }).focus();
            await page.evaluate((welcome) => window.configure({ welcome }), {
                id,
                title,
                messageHtml,
                dismissed: false,
            });
            const dialog = page.getByRole('dialog', {
                name: title,
                exact: true,
            });
            await dialog.waitFor();
            return {
                page,
                dialog,
                continueButton: dialog.getByRole('button', {
                    name: 'Continue',
                    exact: true,
                }),
            };
        }
        const focused = (locator) =>
            locator.evaluate((node) => node === document.activeElement);
        async function readDismissal(page) {
            return {
                focusRestored: await focused(
                    page.getByRole('button', { name: 'Record action' })
                ),
                effects: await effects(page),
            };
        }
        async function readRemount(page) {
            const previous = await page
                .locator('.fixture-native-action')
                .elementHandle();
            try {
                await page.evaluate(() => window.remount());
                await page.waitForFunction(
                    (node) => !node.isConnected,
                    previous
                );
                return {
                    dialogs: await page.getByRole('dialog').count(),
                    guideFrames: await page
                        .locator('iframe[title="Welcome guide"]')
                        .count(),
                    effects: await effects(page),
                };
            } finally {
                await previous.dispose();
            }
        }

        const { page, dialog, continueButton } = await openWelcome(
            'welcome-guide',
            'Welcome with guide',
            '<p>Watch the guide</p><iframe class="ql-video" src="' +
                guideUrl +
                '" title="Welcome guide"></iframe>'
        );
        const iframe = dialog.locator('iframe[title="Welcome guide"]');
        const play = dialog
            .frameLocator('iframe[title="Welcome guide"]')
            .getByRole('button', {
                name: 'Play guide',
                exact: true,
            });
        await play.waitFor({ state: 'visible' });
        evidence.iframe = {
            ready: await play.isVisible(),
            src: await iframe.getAttribute('src'),
            requests: evidence.guideRequests,
            sandbox: await iframe.getAttribute('sandbox'),
            referrerPolicy: await iframe.getAttribute('referrerpolicy'),
            loading: await iframe.getAttribute('loading'),
        };
        const observe = async () => {
            // Chrome transfers sequential focus between browsing contexts
            // asynchronously. Sample the parent state in one browser turn.
            const focus = await dialog.evaluate(async (node) => {
                await new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                );
                const active = node.ownerDocument.activeElement;
                const text = active?.textContent?.trim().slice(0, 80);
                return {
                    parent: {
                        tag: active?.tagName,
                        title: active?.getAttribute('title'),
                        text,
                    },
                    continueFocused:
                        node.contains(active) &&
                        active?.tagName === 'BUTTON' &&
                        text === 'Continue',
                    frameFocused:
                        active ===
                        node.querySelector('iframe[title="Welcome guide"]'),
                };
            });
            return {
                ...focus,
                play: await play.evaluate((node) => ({
                    focused:
                        node === document.activeElement && document.hasFocus(),
                    clicks: [...window.guideClicks],
                })),
                effects: await effects(page),
            };
        };
        evidence.steps.initial = await observe();
        await page.keyboard.press('Shift+Tab');
        const backward = await observe();
        evidence.steps.backward = backward;
        await dialog.screenshot({
            path: join(output, `${label}-welcome-guide-backward.png`),
        });
        if (backward.play.focused && backward.frameFocused) {
            await page.keyboard.press('Enter');
            evidence.steps.play = await observe();
            await page.keyboard.press('Tab');
            const forward = await observe();
            evidence.steps.forward = forward;
            if (forward.continueFocused) {
                await page.keyboard.press('Shift+Tab');
                evidence.steps.backToGuide = await observe();
                await page.keyboard.press('Shift+Tab');
                const wrapped = await observe();
                evidence.steps.reverseWrap = wrapped;
                if (wrapped.continueFocused) {
                    await page.keyboard.press('Enter');
                    await dialog.waitFor({ state: 'hidden' });
                    evidence.steps.dismiss = await readDismissal(page);
                    evidence.steps.remount = await readRemount(page);
                }
            }
        }

        const text = await openWelcome(
            'welcome-text-only',
            'Welcome text only',
            '<p>Text-only welcome</p>'
        );
        evidence.textOnly.initial = await focused(text.continueButton);
        await text.page.keyboard.press('Shift+Tab');
        evidence.textOnly.backward = await focused(text.continueButton);
        await text.page.keyboard.press('Tab');
        evidence.textOnly.forward = await focused(text.continueButton);
        if (evidence.textOnly.forward) {
            await text.page.keyboard.press('Enter');
            await text.dialog.waitFor({ state: 'hidden' });
            evidence.textOnly.dismiss = await readDismissal(text.page);
            evidence.textOnly.remount = await readRemount(text.page);
        }

        const noEffects = {
            intents: [],
            dismissals: [],
            storage: 0,
            reads: 0,
            activations: 0,
        };
        const dismissed = (id) => ({
            ...noEffects,
            intents: ['dismiss-welcome'],
            dismissals: [id],
        });
        assert.deepEqual(evidence.iframe, {
            ready: true,
            src: guideUrl,
            requests: 1,
            sandbox:
                'allow-downloads allow-forms allow-popups allow-presentation allow-same-origin allow-scripts',
            referrerPolicy: 'no-referrer',
            loading: 'lazy',
        });
        assert.equal(evidence.steps.initial.continueFocused, true);
        assert.deepEqual(evidence.steps.initial.effects, noEffects);
        assert.equal(
            backward.play.focused && backward.frameFocused,
            true,
            'Shift+Tab from Continue must focus the ready guide Play button'
        );
        assert.equal(backward.parent.tag, 'IFRAME');
        assert.deepEqual(backward.play.clicks, []);
        assert.deepEqual(backward.effects, noEffects);
        assert.equal(evidence.steps.play.play.focused, true);
        assert.deepEqual(evidence.steps.play.play.clicks, [
            { trusted: true, detail: 0 },
        ]);
        assert.deepEqual(evidence.steps.play.effects, noEffects);
        assert.equal(evidence.steps.forward.continueFocused, true);
        assert.deepEqual(evidence.steps.forward.play.clicks, [
            { trusted: true, detail: 0 },
        ]);
        assert.deepEqual(evidence.steps.forward.effects, noEffects);
        assert.equal(evidence.steps.backToGuide.play.focused, true);
        assert.deepEqual(evidence.steps.backToGuide.effects, noEffects);
        assert.equal(evidence.steps.reverseWrap.continueFocused, true);
        assert.deepEqual(evidence.steps.reverseWrap.play.clicks, [
            { trusted: true, detail: 0 },
        ]);
        assert.deepEqual(evidence.steps.reverseWrap.effects, noEffects);
        assert.deepEqual(evidence.steps.dismiss, {
            focusRestored: true,
            effects: dismissed('welcome-guide'),
        });
        assert.deepEqual(evidence.steps.remount, {
            dialogs: 0,
            guideFrames: 0,
            effects: dismissed('welcome-guide'),
        });
        assert.deepEqual(evidence.textOnly, {
            initial: true,
            backward: true,
            forward: true,
            dismiss: {
                focusRestored: true,
                effects: dismissed('welcome-text-only'),
            },
            remount: {
                dialogs: 0,
                guideFrames: 0,
                effects: dismissed('welcome-text-only'),
            },
        });
        assert.equal(evidence.guideRequests, 1);
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = error.message;
        throw error;
    } finally {
        await context.close();
        evidence.contextClosed = context.pages().length === 0;
    }
}
