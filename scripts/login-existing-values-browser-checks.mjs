import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const fixture = String.raw`
import React, { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '@miniextensions/sdk/react/login-existing-values-picker.css';
import '@miniextensions/sdk/react/login-signup-confirmation-dialog.css';

const duplicate = '  duplicate@example.com  ';
const first = { labels: [duplicate, '', duplicate], offset: 'raw-page-2' };
const second = { labels: ['', duplicate, 'Last option'], offset: null };
const calls = [];
const selections = [];
const trusted = [];
const settingsActivations = [];
const nativeOverlayClicks = [];
const nativeTabs = [];
const nativeQuery = '  Native needle_*  ';
const nativeQueryLabels = Array.from({ length: 40 }, (_, index) => 'Native result ' + (index + 1));
const nativePairQuery = '  Native pair_*  ';
const nativePairLabels = ['  First typed value  ', 'Second typed value'];
const nativeEmptyQuery = 'No native matches';
const signupDraft = 'masked-signup@example.invalid';
const unmaskedDraft = 'visible-signup@example.invalid';
let signupCancels = 0;
const signupCreates = [];
const signupPointers = [];
let submits = 0;
let update;
let release;
let initialFailure = true;
let appendFailure = true;
function App() {
    const [state, setState] = useState({
        session: 'A',
        allowed: true,
        disabled: false,
        masked: false,
        pickerAppearance: undefined,
        signup: null,
        signupAttempt: 'A',
        signupDisabled: false,
        signupAppearance: undefined,
    });
    update = (patch) => flushSync(() => setState(current => ({ ...current, ...patch })));
    return h('form', {
        id: 'login-proof-outer-form',
        onSubmit(event) { event.preventDefault(); submits++; },
    },
    h('label', null, 'Sign-in value', h('input', { type: 'password', defaultValue: signupDraft })),
    h('button', { type: 'button', 'data-testid': 'masked-signup-opener', onClick: () => update({ signup: 'masked' }) }, 'Confirm masked signup'),
    h('button', { type: 'button', onClick: () => update({ signup: 'visible' }) }, 'Confirm visible signup'),
    h(LoginSignupConfirmationDialog, {
        open: state.signup !== null,
        attemptId: state.signupAttempt,
        disabled: state.signupDisabled,
        appearance: state.signupAppearance,
        testIds: { root: 'signup-panel', cancelButton: 'signup-back', confirmButton: 'signup-create' },
        copy: {
            title: (state.signup === 'masked' ? '••••••••' : unmaskedDraft) + ' n’existe pas',
            body: 'Vérifiez la valeur ou créez un nouvel enregistrement.',
            back: 'Retour',
            create: 'Créer',
        },
        onCancel() { signupCancels++; update({ signup: null }); },
        onCreate() { signupCreates.push(state.signupAttempt); },
    }),
    state.pickerAppearance === 'native' && h('input', {
        type: 'text',
        'aria-label': 'Before the native picker',
        'data-testid': 'native-login-before-trigger',
    }),
    h(LoginExistingValuesPicker, {
        owner: {
            extensionSessionId: state.session,
            extensionId: 'login',
            fieldId: 'configured-field',
            viewMode: 'published',
        },
        allowSearchFromExistingValuesInLogin: state.allowed,
        disabled: state.disabled,
        maskPasswordOnLoginScreen: state.masked,
        labels: {
            title: 'Valeurs existantes', error: 'Values unavailable',
            ...(state.pickerAppearance === 'native' && { open: 'Rechercher', search: 'Adresse électronique' }),
        },
        ...(state.pickerAppearance === 'native' && {
            appearance: 'native',
            searchPlaceholder: 'Saisissez quelques lettres',
            triggerContent: h('svg', { 'aria-hidden': 'true', 'data-testid': 'native-login-search-icon', width: 20, height: 20, viewBox: '0 0 20 20' },
                h('path', { d: 'm14 14 4 4', stroke: 'currentColor' }),
                h('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor' })),
            testIds: { dialog: 'native-login-search-dialog', overlay: 'native-login-search-overlay' },
        }),
        titleAction: h('button', {
            type: 'button',
            onClick(event) { settingsActivations.push(event.isTrusted); },
        }, 'Réglages'),
        async loadOptions({ searchTerm, offset, extensionSessionId, signal }) {
            const call = { query: searchTerm, offset, owner: extensionSessionId, aborted: false };
            calls.push(call);
            signal.addEventListener('abort', () => { call.aborted = true; }, { once: true });
            if (extensionSessionId === 'held') {
                return new Promise(resolve => { release = resolve; });
            }
            if (state.pickerAppearance === 'native') {
                if (searchTerm === nativeQuery) return { labels: nativeQueryLabels, offset: null };
                if (searchTerm === nativePairQuery) return { labels: nativePairLabels, offset: null };
                if (searchTerm === nativeEmptyQuery) return { labels: [], offset: null };
            }
            if (searchTerm) return { labels: ['Current query result'], offset: null };
            if (offset !== null) {
                if (appendFailure) {
                    appendFailure = false;
                    throw new Error('private append error');
                }
                return second;
            }
            if (initialFailure) {
                initialFailure = false;
                throw new Error('private initial error');
            }
            return first;
        },
        onSelect(value) { selections.push(value); },
    }),
    state.pickerAppearance === 'native' && h('button', {
        type: 'submit',
        'data-testid': 'native-login-after-trigger',
    }, 'After the native picker'));
}
document.addEventListener('click', event => {
    if (event.target.closest('[role=dialog] li button')) trusted.push(event.isTrusted);
});
document.addEventListener('click', event => {
    if (event.target.closest('[data-testid=native-login-search-overlay]')) nativeOverlayClicks.push(event.isTrusted);
}, true);
document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && event.target.closest('[data-testid=native-login-search-dialog]')) {
        nativeTabs.push({ trusted: event.isTrusted, backward: event.shiftKey, target: event.target.tagName });
    }
}, true);
for (const type of ['pointerdown', 'pointerup']) {
    document.addEventListener(type, event => {
        const dialog = event.target instanceof Element && event.target.closest('dialog[open]');
        if (!dialog) return;
        const { left, right, top, bottom } = dialog.getBoundingClientRect();
        const outside = event.clientX < left || event.clientX >= right ||
            event.clientY < top || event.clientY >= bottom;
        signupPointers.push({
            type,
            trusted: event.isTrusted,
            location: outside ? 'backdrop' : event.target === dialog ? 'padding' : 'panel',
        });
    }, true);
}
createRoot(document.querySelector('main')).render(h(StrictMode, null, h(App)));
window.pickerProof = {
    update: (patch) => update(patch),
    release: () => release({ labels: ['Retired owner result'], offset: 'old-page' }),
    snapshot: () => ({ react: React.version, selections, calls, submits, trusted, settingsActivations, signupCancels, signupCreates, signupPointers }),
    overlayClicks: () => nativeOverlayClicks.slice(),
    nativeTabs: () => nativeTabs.slice(),
};
`;

export async function checkLoginExistingValuesBrowser({
    browser,
    consumer,
    evidence,
    output,
    expectedReactVersion,
    format = 'esm',
}) {
    assert(format === 'esm' || format === 'cjs');
    const scratch = mkdtempSync(join(consumer, '.login-picker-browser-'));
    let context;
    const pageErrors = [];
    const unexpectedRequests = [];
    try {
        const entry = join(scratch, 'entry.mjs');
        const sdkImport =
            format === 'esm'
                ? "import { LoginExistingValuesPicker, LoginSignupConfirmationDialog } from '@miniextensions/sdk/react';"
                : "const { LoginExistingValuesPicker, LoginSignupConfirmationDialog } = require('@miniextensions/sdk/react');";
        writeFileSync(entry, sdkImport + '\n' + fixture);
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            outdir: scratch,
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        const inputs = Object.keys(bundle.metafile.inputs);
        assert(
            inputs.some((path) =>
                path.endsWith(
                    `/dist/${format}/react/LoginExistingValuesPicker.js`
                )
            )
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/react/login-existing-values-picker.css')
            )
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/react/login-signup-confirmation-dialog.css')
            )
        );
        assert(
            inputs.some((path) =>
                path.endsWith(
                    `/dist/${format}/react/LoginSignupConfirmationDialog.js`
                )
            )
        );

        const assets = new Map(
            bundle.outputFiles.map((file) => [
                '/' + file.path.split('/').at(-1),
                file.text,
            ])
        );
        const origin = 'http://login-picker.test';
        context = await browser.newContext();
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.origin === origin && url.pathname === '/') {
                return route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><link rel="icon" href="data:,"><link rel="stylesheet" href="/entry.css"><main></main><script type="module" src="/entry.js"></script>',
                });
            }
            if (url.origin === origin && assets.has(url.pathname)) {
                return route.fulfill({
                    contentType: url.pathname.endsWith('.css')
                        ? 'text/css'
                        : 'text/javascript',
                    body: assets.get(url.pathname),
                });
            }
            unexpectedRequests.push(route.request().url());
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(6000);
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(origin);
        const button = (name) =>
            page.getByRole('button', { name, exact: true });
        const trigger = button('Find an existing value');
        const dialog = page.getByRole('dialog', {
            name: 'Valeurs existantes',
            exact: true,
        });
        const search = dialog.getByRole('searchbox');
        const choices = dialog.locator('li button');
        const read = () => page.evaluate(() => window.pickerProof.snapshot());
        const focus = async (locator) =>
            assert(
                await locator.evaluate(
                    (element) => document.activeElement === element
                )
            );
        const patch = (next) =>
            page.evaluate((x) => window.pickerProof.update(x), next);
        const duplicate = '  duplicate@example.com  ';
        await trigger.waitFor();
        assert.deepEqual((await read()).calls, []);
        await trigger.focus();
        await page.keyboard.press('Enter');
        const error = dialog.getByRole('alert');
        await error.waitFor();
        assert.equal(await error.textContent(), 'Values unavailable');
        await focus(search);
        await button('Retry').click();
        await button('Load more').click();
        await error.waitFor();
        assert.deepEqual(await choices.allTextContents(), [
            duplicate,
            '',
            duplicate,
        ]);
        await button('Retry').click();
        await choices.nth(5).waitFor();
        assert.deepEqual(await choices.allTextContents(), [
            duplicate,
            '',
            duplicate,
            '',
            duplicate,
            'Last option',
        ]);
        const settings = dialog.getByRole('button', {
            name: 'Réglages',
            exact: true,
        });
        const beforeSettings = await read();
        await settings.click();
        await focus(settings);
        assert.deepEqual((await read()).settingsActivations, [true]);
        await page.keyboard.press('Enter');
        const afterSettings = await read();
        assert.deepEqual(afterSettings.settingsActivations, [true, true]);
        assert.deepEqual(afterSettings.selections, []);
        assert.deepEqual(afterSettings.calls, beforeSettings.calls);
        assert.equal(afterSettings.submits, 0);
        assert.equal(await dialog.isVisible(), true);
        const blank = choices.nth(3);
        assert.equal(await blank.getAttribute('aria-label'), 'Blank value');
        await blank.click();
        await dialog.waitFor({ state: 'hidden' });
        await focus(trigger);
        assert.deepEqual((await read()).selections, ['']);
        assert.deepEqual(
            (await read()).calls.map(({ offset }) => offset),
            [null, null, 'raw-page-2', 'raw-page-2']
        );

        await page.keyboard.press('Enter');
        await choices.nth(2).waitFor();
        await focus(search);
        for (let index = 0; index < 3; index++) {
            await page.keyboard.press('Tab');
            await focus(choices.nth(index));
        }
        await page.keyboard.press('Space');
        await dialog.waitFor({ state: 'hidden' });
        await focus(trigger);
        assert.deepEqual((await read()).selections, ['', duplicate]);

        const beforeArrowSelection = (await read()).calls.length;
        await trigger.click();
        await choices.nth(2).waitFor();
        await focus(search);
        await page.keyboard.press('ArrowDown');
        await focus(choices.nth(0));
        await page.keyboard.down('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await focus(trigger);
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        assert.equal(await dialog.count(), 0);
        assert.deepEqual((await read()).selections, ['', duplicate, duplicate]);
        assert.equal((await read()).calls.length, beforeArrowSelection + 1);

        await trigger.click();
        await choices.nth(2).waitFor();
        await button('Load more').click();
        await choices.nth(5).waitFor();
        await search.click();
        // Follow each occurrence, including matching labels on both pages.
        for (const index of [0, 1, 2, 3, 4]) {
            await page.keyboard.press('ArrowDown');
            await focus(choices.nth(index));
        }
        await page.keyboard.press('ArrowUp');
        await focus(choices.nth(3));
        await page.keyboard.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await focus(trigger);
        const selectedLabels = ['', duplicate, duplicate, ''];
        assert.deepEqual((await read()).selections, selectedLabels);

        await trigger.click();
        await choices.nth(0).waitFor();
        await page.keyboard.press('ArrowDown');
        await focus(choices.nth(0));
        await page.keyboard.press('ArrowUp');
        await focus(search);
        await search.fill('  Needle_*  ');
        await page.keyboard.press('Enter');
        await button('Current query result').waitFor();
        assert.equal((await read()).calls.at(-1).query, '  Needle_*  ');
        await focus(search);
        await page.keyboard.press('Enter');
        assert.deepEqual((await read()).selections, selectedLabels);

        const beforeEscape = await read();
        await search.evaluate((input) => {
            input.dispatchEvent(
                new CompositionEvent('compositionstart', { bubbles: true })
            );
        });
        const deliverEscape = (options) =>
            search.evaluate((input, options) => {
                const event = new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                    ...options,
                });
                let reachedDocument = false;
                const observe = (observed) => {
                    if (observed === event) reachedDocument = true;
                };
                document.addEventListener('keydown', observe);
                const allowed = input.dispatchEvent(event);
                document.removeEventListener('keydown', observe);
                return { allowed, reachedDocument };
            }, options);
        const composingEscape = await deliverEscape({ isComposing: true });
        evidence.imeEscape = composingEscape;
        assert.deepEqual(composingEscape, {
            allowed: true,
            reachedDocument: true,
        });
        assert.equal(await dialog.isVisible(), true);
        assert.equal(await search.inputValue(), '  Needle_*  ');
        await focus(search);
        await search.evaluate((input) => {
            input.dispatchEvent(
                new CompositionEvent('compositionend', { bubbles: true })
            );
        });
        const repeatingEscape = await deliverEscape({ repeat: true });
        assert.deepEqual(repeatingEscape, {
            allowed: false,
            reachedDocument: false,
        });
        assert.equal(await dialog.isVisible(), true);
        assert.equal(await search.inputValue(), '  Needle_*  ');
        await focus(search);
        assert.deepEqual(await read(), beforeEscape);

        await page.evaluate(() => {
            document.addEventListener(
                'keydown',
                (event) => {
                    window.pickerProof.escape = {
                        key: event.key,
                        trusted: event.isTrusted,
                        repeating: event.repeat,
                    };
                },
                { capture: true, once: true }
            );
        });
        await page.keyboard.press('Escape');
        assert.deepEqual(await page.evaluate(() => window.pickerProof.escape), {
            key: 'Escape',
            trusted: true,
            repeating: false,
        });
        await dialog.waitFor({ state: 'hidden' });
        await focus(trigger);
        const afterEscape = await read();
        assert.equal(afterEscape.calls.length, beforeEscape.calls.length);
        assert.deepEqual(afterEscape.selections, beforeEscape.selections);
        assert.equal(afterEscape.submits, beforeEscape.submits);
        evidence.repeatingEscape = repeatingEscape;
        evidence.trustedEscapeRestoredTrigger = true;

        await trigger.click();
        await choices.nth(0).waitFor();
        await page.keyboard.press('ArrowDown');
        await focus(choices.nth(0));
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await focus(trigger);

        await patch({ session: 'held' });
        await trigger.click();
        await page.waitForFunction(
            () => window.pickerProof.snapshot().calls.at(-1)?.owner === 'held'
        );
        await patch({ session: 'A' });
        await dialog.waitFor({ state: 'hidden' });
        await trigger.click();
        await choices.nth(2).waitFor();
        await page.evaluate(() => window.pickerProof.release());
        assert.equal(await button('Retired owner result').count(), 0);
        assert(
            await read().then(
                ({ calls }) =>
                    calls.find(({ owner }) => owner === 'held').aborted
            )
        );
        await focus(search);
        await button('Close').click();
        await focus(trigger);

        const beforeSignup = await read();
        const draft = page.getByLabel('Sign-in value');
        const maskedSignup = button('Confirm masked signup');
        const visibleSignup = button('Confirm visible signup');
        const signupDialog = page.getByRole('dialog', {
            name: '•••••••• n’existe pas',
            exact: true,
        });
        const back = signupDialog.getByRole('button', { name: 'Retour' });
        const create = signupDialog.getByRole('button', { name: 'Créer' });
        await maskedSignup.click();
        await focus(back);
        assert.doesNotMatch(
            await signupDialog.ariaSnapshot(),
            /masked-signup@example\.invalid/
        );
        assert.doesNotMatch(
            await signupDialog.evaluate((node) => node.outerHTML),
            /masked-signup@example\.invalid/
        );
        await page.keyboard.press('Enter');
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        assert.equal((await read()).signupCancels, 1);
        assert.deepEqual((await read()).signupCreates, []);
        assert.equal(await draft.inputValue(), 'masked-signup@example.invalid');

        await maskedSignup.click();
        await focus(back);
        await page.keyboard.press('Escape');
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        assert.equal((await read()).signupCancels, 2);
        assert.deepEqual((await read()).signupCreates, []);
        assert.equal(await draft.inputValue(), 'masked-signup@example.invalid');

        await maskedSignup.click();
        await focus(back);
        await page.keyboard.press('Tab');
        await focus(create);
        await page.keyboard.press('Space');
        await page.keyboard.press('Space');
        assert.deepEqual((await read()).signupCreates, ['A']);
        assert.equal((await read()).signupCancels, 2);
        assert.equal(await draft.inputValue(), 'masked-signup@example.invalid');
        await patch({ signup: null });
        await signupDialog.waitFor({ state: 'hidden' });

        await visibleSignup.click();
        const visible = page.getByRole('dialog', {
            name: 'visible-signup@example.invalid n’existe pas',
            exact: true,
        });
        await visible
            .getByText('Vérifiez la valeur ou créez un nouvel enregistrement.')
            .waitFor();
        await focus(visible.getByRole('button', { name: 'Retour' }));
        await patch({ signup: null });
        await visible.waitFor({ state: 'hidden' });
        const assertSignupIntents = async (creates, cancels = 2) => {
            const proof = await read();
            assert.deepEqual(proof.signupCreates, creates);
            assert.equal(proof.signupCancels, cancels);
            assert.equal(proof.submits, 0);
            assert.deepEqual(proof.calls, beforeSignup.calls);
            assert.equal(
                await draft.inputValue(),
                'masked-signup@example.invalid'
            );
        };

        // Finish a real mouse gesture after the host replaces the open attempt.
        await maskedSignup.click();
        await create.hover();
        await page.mouse.down();
        await patch({ signupAttempt: 'B' });
        await focus(back);
        await create.hover();
        await page.mouse.up();
        await assertSignupIntents(['A']);
        await create.click();
        await assertSignupIntents(['A', 'B']);

        // Suspending a decision does not clear its already-settled state.
        await patch({ signupDisabled: true });
        await patch({ signupDisabled: false });
        assert(await create.isDisabled());
        assert(await back.isDisabled());

        // The replacement starts ready, but completion of the held Space is stale.
        await patch({ signupAttempt: 'C' });
        await focus(back);
        await page.keyboard.press('Tab');
        await focus(create);
        await page.keyboard.down('Space');
        await patch({ signupAttempt: 'D' });
        await focus(back);
        await page.keyboard.up('Space');
        await assertSignupIntents(['A', 'B']);
        await page.keyboard.press('Tab');
        await focus(create);
        await page.keyboard.press('Space');
        await assertSignupIntents(['A', 'B', 'D']);

        // Disabling an unsettled attempt retires its held input immediately.
        await patch({ signupAttempt: 'E' });
        await create.hover();
        await page.mouse.down();
        await patch({ signupDisabled: true });
        assert(await create.isDisabled());
        assert(await back.isDisabled());
        await page.keyboard.press('Escape');
        await signupDialog.waitFor();
        await patch({ signupDisabled: false });
        await create.hover();
        await page.mouse.up();
        await assertSignupIntents(['A', 'B', 'D']);
        await create.click();
        await assertSignupIntents(['A', 'B', 'D', 'E']);

        // Closing and reopening the controlled dialog retires the old Space,
        // even when the host uses the same attempt key on reopening.
        await patch({ signupAttempt: 'F' });
        await create.focus();
        await page.keyboard.down('Space');
        await patch({ signup: null });
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        await patch({ signup: 'masked' });
        await focus(back);
        await page.keyboard.up('Space');
        await assertSignupIntents(['A', 'B', 'D', 'E']);
        await page.keyboard.press('Escape');
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        await assertSignupIntents(['A', 'B', 'D', 'E'], 3);

        // The replacement must ignore repeats from a held Enter.
        await patch({ signup: 'masked', signupAttempt: 'G' });
        await focus(back);
        await page.keyboard.press('Tab');
        await focus(create);
        await page.keyboard.down('Enter');
        await assertSignupIntents(['A', 'B', 'D', 'E', 'G'], 3);
        await patch({ signupAttempt: 'H' });
        await focus(back);
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        await assertSignupIntents(['A', 'B', 'D', 'E', 'G'], 3);
        await page.keyboard.press('Enter');
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        await assertSignupIntents(['A', 'B', 'D', 'E', 'G'], 4);

        const completedSignupAttempts = (await read()).signupCreates;
        const backdrop = { x: 4, y: 4 };
        const pressAt = async ({ x, y }) => {
            await page.mouse.move(x, y);
            await page.mouse.down();
        };
        const pointerTrace = async (start, location) => {
            const events = (await read()).signupPointers.slice(start);
            assert.deepEqual(events, [
                { type: 'pointerdown', trusted: true, location },
                { type: 'pointerup', trusted: true, location },
            ]);
            return events;
        };
        const beforeImage = `login-signup-backdrop-${expectedReactVersion}-before.png`;
        const afterImage = `login-signup-backdrop-${expectedReactVersion}-after.png`;
        await maskedSignup.click();
        await focus(back);
        const panel = await signupDialog.boundingBox();
        const heading = await signupDialog.getByRole('heading').boundingBox();
        assert(panel && heading);
        assert(backdrop.x < panel.x && backdrop.y < panel.y);
        const insidePanel = {
            x: heading.x + heading.width / 2,
            y: heading.y + heading.height / 2,
        };
        const insidePadding = { x: panel.x + 5, y: panel.y + 5 };
        assert(
            await signupDialog.evaluate(
                (node, { x, y }) =>
                    node.ownerDocument.elementFromPoint(x, y) === node,
                insidePadding
            )
        );
        const insideClicks = [];
        for (const [point, location] of [
            [insidePanel, 'panel'],
            [insidePadding, 'padding'],
        ]) {
            const start = (await read()).signupPointers.length;
            await pressAt(point);
            await page.mouse.up();
            insideClicks.push(...(await pointerTrace(start, location)));
            assert(
                await signupDialog.isVisible(),
                `Click in ${location} dismissed signup`
            );
            await assertSignupIntents(completedSignupAttempts, 4);
        }

        await back.focus();
        await focus(back);
        await page.screenshot({ path: join(output, beforeImage) });
        const beforeBackdrop = await read();
        await pressAt(backdrop);
        assert(await signupDialog.isVisible());
        await assertSignupIntents(completedSignupAttempts, 4);
        await page.mouse.up();
        const outsideClick = await pointerTrace(
            beforeBackdrop.signupPointers.length,
            'backdrop'
        );
        const afterBackdrop = await read();
        await page.screenshot({ path: join(output, afterImage) });
        evidence.signupBackdrop = {
            insideClicks,
            outsideClick,
            dialogClosed: !(await signupDialog.isVisible()),
            restoredFocus: await page
                .getByTestId('masked-signup-opener')
                .evaluate((node) => node.ownerDocument.activeElement === node),
            cancels: afterBackdrop.signupCancels - beforeBackdrop.signupCancels,
            creates:
                afterBackdrop.signupCreates.length -
                beforeBackdrop.signupCreates.length,
            submits: afterBackdrop.submits - beforeBackdrop.submits,
            pickerReads:
                afterBackdrop.calls.length - beforeBackdrop.calls.length,
            unexpectedRequests: [...unexpectedRequests],
            draftPreserved:
                (await draft.inputValue()) === 'masked-signup@example.invalid',
            screenshots: [beforeImage, afterImage],
        };
        assert.equal(
            evidence.signupBackdrop.dialogClosed,
            true,
            'Trusted backdrop click must dismiss signup'
        );
        await focus(maskedSignup);
        await assertSignupIntents(completedSignupAttempts, 5);

        // A held backdrop gesture cannot cross suspension or a new dialog lifetime.
        await maskedSignup.click();
        await pressAt(backdrop);
        await patch({ signupDisabled: true });
        await patch({ signupDisabled: false });
        await page.mouse.up();
        assert(
            await signupDialog.isVisible(),
            'Suspension did not retire the held backdrop'
        );
        await assertSignupIntents(completedSignupAttempts, 5);

        await pressAt(backdrop);
        await patch({ signupAttempt: 'backdrop-successor' });
        await focus(back);
        await page.mouse.up();
        assert(
            await signupDialog.isVisible(),
            'A held backdrop dismissed its replacement'
        );
        await assertSignupIntents(completedSignupAttempts, 5);

        await pressAt(backdrop);
        await patch({ signup: null });
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        await patch({ signup: 'masked' });
        await focus(back);
        await page.mouse.up();
        assert(
            await signupDialog.isVisible(),
            'A held backdrop dismissed a reopened attempt'
        );
        await assertSignupIntents(completedSignupAttempts, 5);

        await page.keyboard.press('Escape');
        await signupDialog.waitFor({ state: 'hidden' });
        await focus(maskedSignup);
        await assertSignupIntents(completedSignupAttempts, 6);
        Object.assign(evidence.signupBackdrop, {
            heldGesturesRetired: ['disabled', 'replaced', 'reopened'],
            escapeCancels:
                (await read()).signupCancels - afterBackdrop.signupCancels,
        });

        const initialViewport = page.viewportSize();
        assert(initialViewport);
        const nativeSignupFrames = [];
        for (const width of [1280, 375]) {
            await page.setViewportSize({ width, height: 800 });
            await patch({
                signupAttempt: `native-${width}`,
                signupAppearance: 'native',
            });
            await maskedSignup.click();
            const styled = page.getByTestId('signup-panel');
            await styled.waitFor();
            await styled.evaluate(async (element) => {
                await Promise.all(
                    element
                        .getAnimations()
                        .map((animation) => animation.finished)
                );
            });
            const styledBack = styled.getByTestId('signup-back');
            const styledCreate = styled.getByTestId('signup-create');
            await focus(styledBack);
            await page.keyboard.press('Shift+Tab');
            await focus(styledCreate);
            assert.equal(
                await styledCreate.evaluate((element) => {
                    const style = getComputedStyle(element);
                    return style.backgroundColor + ' ' + style.outlineColor;
                }),
                'rgb(37, 99, 235) rgb(37, 99, 235)'
            );
            await page.keyboard.press('Tab');
            await focus(styledBack);
            const bounds = await styled.boundingBox();
            const backBounds = await styledBack.boundingBox();
            const createBounds = await styledCreate.boundingBox();
            assert(bounds && backBounds && createBounds);
            assert.equal(
                await styled.evaluate(
                    (element) =>
                        getComputedStyle(element, '::backdrop').backgroundColor
                ),
                'rgba(107, 114, 128, 0.75)'
            );
            if (width === 1280) {
                assert.equal(bounds.width, 512);
                assert.equal(backBounds.y, createBounds.y);
                assert(backBounds.x < createBounds.x);
            } else {
                assert(bounds.width <= width - 32);
                assert.equal(backBounds.width, bounds.width - 24);
                assert.equal(createBounds.width, backBounds.width);
                assert(createBounds.y < backBounds.y);
            }
            const frame = `login-signup-native-${expectedReactVersion}-${width}.png`;
            await page.screenshot({ path: join(output, frame) });
            await page.mouse.click(backdrop.x, backdrop.y);
            await styled.waitFor({ state: 'hidden' });
            await focus(maskedSignup);
            nativeSignupFrames.push({
                width,
                bounds,
                backBounds,
                createBounds,
                frame,
            });
        }
        await page.setViewportSize(initialViewport);
        await assertSignupIntents(completedSignupAttempts, 8);
        evidence.nativeSignupFrames = nativeSignupFrames;

        await trigger.click();
        await choices.nth(0).waitFor();
        await page.keyboard.press('ArrowDown');
        await focus(choices.nth(0));
        const beforeDenied = (await read()).calls.length;
        await patch({ disabled: true });
        await dialog.waitFor({ state: 'hidden' });
        await page.keyboard.press('Enter');
        assert.equal(await trigger.isDisabled(), true);
        await trigger.evaluate((element) => element.click());
        await patch({ masked: true, disabled: false });
        assert.equal(await trigger.count(), 0);
        await patch({ masked: false, allowed: false });
        assert.equal(await trigger.count(), 0);
        const proof = await read();
        assert.equal(proof.calls.length, beforeDenied);
        assert.deepEqual(proof.selections, selectedLabels);
        assert.deepEqual(proof.trusted, [true, true, true, true]);
        assert.deepEqual(proof.settingsActivations, [true, true]);
        assert.equal(proof.submits, 0);
        assert.equal(proof.react, expectedReactVersion);

        await patch({ allowed: true, pickerAppearance: 'native' });
        const nativeTrigger = button('Rechercher');
        await nativeTrigger.getByTestId('native-login-search-icon').waitFor();
        const beforeNativeTrigger = page.getByTestId(
            'native-login-before-trigger'
        );
        const afterNativeTrigger = page.getByTestId(
            'native-login-after-trigger'
        );
        const nativeFormOwner = (locator) =>
            locator.evaluate((element) => element.form?.id ?? null);
        const nativeDialog = page.getByRole('dialog', {
            name: 'Valeurs existantes',
            exact: true,
        });
        const nativeSearch = nativeDialog.getByRole('combobox', {
            name: 'Adresse électronique',
            exact: true,
        });
        const nativeList = nativeDialog.getByRole('listbox');
        const nativeOptions = nativeList.getByRole('option');
        const nativeSettings = nativeDialog.getByRole('button', {
            name: 'Réglages',
            exact: true,
        });
        const nativeMore = nativeDialog.getByRole('button', {
            name: 'Load more',
            exact: true,
        });
        const readNativeTabs = () =>
            page.evaluate(() => window.pickerProof.nativeTabs());
        const openNative = async () => {
            await nativeTrigger.click();
            await nativeOptions.nth(2).waitFor();
            await focus(nativeSearch);
        };
        const activeNativeOption = async (index) => {
            const id = await nativeOptions.nth(index).getAttribute('id');
            assert(id);
            assert.equal(
                await nativeSearch.getAttribute('aria-activedescendant'),
                id
            );
            await focus(nativeSearch);
            return id;
        };
        const readNativeSelection = async (expected = []) => {
            const current = await read();
            assert.deepEqual(
                current.selections.slice(proof.selections.length),
                expected
            );
            assert.equal(current.submits, 0);
        };

        await openNative();
        assert.equal(
            await nativeDialog.getAttribute('data-testid'),
            'native-login-search-dialog'
        );
        assert(
            await nativeDialog.evaluate(
                (element) =>
                    element instanceof HTMLDialogElement && element.open
            )
        );
        assert.equal(
            await nativeSearch.getAttribute('placeholder'),
            'Saisissez quelques lettres'
        );
        const outerFormOwners = await Promise.all(
            [beforeNativeTrigger, nativeTrigger, afterNativeTrigger].map(
                nativeFormOwner
            )
        );
        assert.deepEqual(
            outerFormOwners,
            Array(3).fill('login-proof-outer-form')
        );
        assert.equal(await afterNativeTrigger.getAttribute('type'), 'submit');
        const modalFormAncestor = await nativeDialog.evaluate(
            (element) => element.closest('form')?.id ?? null
        );
        const modalFormOwners = await Promise.all(
            [nativeSearch, nativeSettings, nativeMore].map(nativeFormOwner)
        );
        assert.equal(modalFormAncestor, null);
        assert.deepEqual(modalFormOwners, [null, null, null]);
        assert.equal(
            await nativeSearch.getAttribute('aria-activedescendant'),
            null
        );
        await page.keyboard.press('Enter');
        assert(await nativeDialog.isVisible());
        await focus(nativeSearch);
        await readNativeSelection();

        await page.keyboard.press('Shift+Tab');
        await focus(nativeSettings);
        await page.keyboard.press('Shift+Tab');
        await focus(nativeMore);
        await page.keyboard.press('Tab');
        await focus(nativeSettings);
        await page.keyboard.press('Tab');
        await focus(nativeSearch);
        await page.keyboard.press('Tab');
        await focus(nativeMore);
        await readNativeSelection();
        const unhighlightedTabEvents = await readNativeTabs();
        assert.deepEqual(unhighlightedTabEvents, [
            { trusted: true, backward: true, target: 'INPUT' },
            { trusted: true, backward: true, target: 'BUTTON' },
            { trusted: true, backward: false, target: 'BUTTON' },
            { trusted: true, backward: false, target: 'BUTTON' },
            { trusted: true, backward: false, target: 'INPUT' },
        ]);

        await nativeSettings.click();
        assert.deepEqual(
            (await read()).settingsActivations.slice(
                proof.settingsActivations.length
            ),
            [true]
        );
        assert(await nativeDialog.isVisible());
        await nativeSearch.click();
        await page.keyboard.press('ArrowDown');
        await activeNativeOption(0);
        const nativeQuery = '  Native needle_*  ';
        const beforeNativeQuery = (await read()).calls.length;
        await page.keyboard.type(nativeQuery);
        await nativeOptions.nth(39).waitFor();
        await focus(nativeSearch);
        assert.equal(await nativeSearch.inputValue(), nativeQuery);
        assert.deepEqual(
            (await read()).calls
                .slice(beforeNativeQuery)
                .map(({ query, offset }) => [query, offset]),
            [[nativeQuery, null]]
        );
        await readNativeSelection();

        const listId = await nativeList.getAttribute('id');
        assert(listId);
        assert.equal(await nativeSearch.getAttribute('aria-controls'), listId);
        const initialScroll = await nativeList.evaluate(
            (element) => element.scrollTop
        );
        await page.keyboard.press('End');
        const lastOptionId = await activeNativeOption(39);
        await page.waitForFunction(
            ({ listId, optionId, initialScroll }) => {
                const list = document.getElementById(listId);
                const option = document.getElementById(optionId);
                if (!list || !option || list.scrollTop <= initialScroll)
                    return false;
                const optionBounds = option.getBoundingClientRect();
                const listBounds = list.getBoundingClientRect();
                return (
                    optionBounds.top >= listBounds.top &&
                    optionBounds.bottom <= listBounds.bottom
                );
            },
            { listId, optionId: lastOptionId, initialScroll }
        );
        const lastOptionScroll = await nativeList.evaluate(
            (element) => element.scrollTop
        );
        await page.keyboard.press('Escape');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(nativeTrigger);
        await readNativeSelection();

        await openNative();
        assert.deepEqual(await nativeOptions.allTextContents(), [
            duplicate,
            '',
            duplicate,
        ]);
        const occurrenceIds = [];
        for (let index = 0; index < 3; index++) {
            await page.keyboard.press('ArrowDown');
            occurrenceIds.push(await activeNativeOption(index));
        }
        assert.equal(new Set(occurrenceIds).size, 3);
        await page.keyboard.press('Enter');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(nativeTrigger);
        await readNativeSelection([duplicate]);

        await openNative();
        await page.keyboard.press('ArrowDown');
        await activeNativeOption(0);
        await page.keyboard.press('ArrowDown');
        const tabSelectedOccurrence = await activeNativeOption(1);
        await page.keyboard.press('Tab');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(afterNativeTrigger);
        await readNativeSelection([duplicate, '']);

        await openNative();
        await page.keyboard.press('ArrowDown');
        const reverseTabSelectedOccurrence = await activeNativeOption(0);
        await page.keyboard.press('Shift+Tab');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(beforeNativeTrigger);
        await readNativeSelection([duplicate, '', duplicate]);
        const highlightedTabEvents = (await readNativeTabs()).slice(
            unhighlightedTabEvents.length
        );
        assert.deepEqual(highlightedTabEvents, [
            { trusted: true, backward: false, target: 'INPUT' },
            { trusted: true, backward: true, target: 'INPUT' },
        ]);

        await openNative();
        const outside = await page
            .getByTestId('native-login-search-overlay')
            .evaluate((overlay) => {
                const { top, left, right, bottom } =
                    overlay.getBoundingClientRect();
                return [
                    [left + 4, top + 4],
                    [right - 4, top + 4],
                    [left + 4, bottom - 4],
                    [right - 4, bottom - 4],
                ].find(([x, y]) => {
                    const target = document.elementFromPoint(x, y);
                    return target != null && overlay.contains(target);
                });
            });
        assert(outside, 'Expected a physically exposed native picker overlay');
        await page.mouse.click(...outside);
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(nativeTrigger);
        await readNativeSelection([duplicate, '', duplicate]);
        const trustedOutside = await page.evaluate(() =>
            window.pickerProof.overlayClicks()
        );
        assert.deepEqual(trustedOutside, [true]);
        assert.equal(await draft.inputValue(), 'masked-signup@example.invalid');

        await nativeTrigger.evaluate((element) => {
            const witness = { element, focusEvents: 0 };
            const onFocus = () => witness.focusEvents++;
            element.addEventListener('focus', onFocus);
            window.pickerProof.retiredOpener = { witness, onFocus };
        });
        await beforeNativeTrigger.focus();
        await openNative();
        const focusBeforeRetirement = await page.evaluate(
            () => window.pickerProof.retiredOpener.witness.focusEvents
        );
        assert(
            focusBeforeRetirement > 0,
            'Expected the opener focus witness to observe the trusted opening'
        );
        await patch({ session: 'native-replacement' });
        await page
            .getByTestId('native-login-search-dialog')
            .waitFor({ state: 'detached' });
        await nativeTrigger.waitFor();
        const ownerRetirement = await nativeTrigger.evaluate(
            (successor, focusBefore) => {
                const { witness, onFocus } = window.pickerProof.retiredOpener;
                witness.element.removeEventListener('focus', onFocus);
                delete window.pickerProof.retiredOpener;
                return {
                    dialogDetached: !document.querySelector(
                        '[data-testid=native-login-search-dialog]'
                    ),
                    oldTriggerDisconnected: !witness.element.isConnected,
                    successorIsDistinct: successor !== witness.element,
                    restorationFocusEvents: witness.focusEvents - focusBefore,
                };
            },
            focusBeforeRetirement
        );
        assert.deepEqual(ownerRetirement, {
            dialogDetached: true,
            oldTriggerDisconnected: true,
            successorIsDistinct: true,
            restorationFocusEvents: 0,
        });
        await readNativeSelection([duplicate, '', duplicate]);

        evidence.nativeLoginCombobox = {
            rawQuery: nativeQuery,
            occurrenceIds,
            selectedOccurrence: occurrenceIds[2],
            tabSelectedOccurrence,
            reverseTabSelectedOccurrence,
            formOwnership: {
                outerFormOwners,
                modalFormAncestor,
                modalFormOwners,
            },
            unhighlightedTabEvents,
            highlightedTabEvents,
            tabFocusAfter: {
                forward: 'submit after trigger',
                backward: 'input before trigger',
            },
            lastOptionScroll,
            selections: (await read()).selections.slice(
                proof.selections.length
            ),
            trustedOutside: trustedOutside[0],
            restoredFocusAfter: ['Escape', 'Enter', 'outside'],
            ownerRetirement,
            credentialDraftPreserved: true,
            submits: (await read()).submits,
        };

        const previousNativeSelections =
            evidence.nativeLoginCombobox.selections;
        const nativePairQuery = '  Native pair_*  ';
        const nativePairLabels = [
            '  First typed value  ',
            'Second typed value',
        ];
        const typeNativeQuery = async (query) => {
            await focus(nativeSearch);
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.type(query);
            assert.equal(await nativeSearch.inputValue(), query);
            await page.waitForFunction(
                (expected) =>
                    window.pickerProof.snapshot().calls.at(-1)?.query ===
                    expected,
                query
            );
        };
        const replaceWithPair = async () => {
            await typeNativeQuery(nativePairQuery);
            await nativeOptions
                .filter({ hasText: 'Second typed value' })
                .waitFor();
            assert.deepEqual(
                await nativeOptions.allTextContents(),
                nativePairLabels
            );
            return activeNativeOption(0);
        };
        const openWithoutHighlight = async () => {
            await openNative();
            assert.deepEqual(await nativeOptions.allTextContents(), [
                duplicate,
                '',
                duplicate,
            ]);
            assert.equal(
                await nativeSearch.getAttribute('aria-activedescendant'),
                null
            );
        };

        await openWithoutHighlight();
        const enterHighlighted = await replaceWithPair();
        await readNativeSelection(previousNativeSelections);
        await page.keyboard.press('Enter');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(nativeTrigger);
        await readNativeSelection([
            ...previousNativeSelections,
            nativePairLabels[0],
        ]);

        await openWithoutHighlight();
        const tabHighlighted = await replaceWithPair();
        await page.keyboard.press('Tab');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(afterNativeTrigger);
        const beforeEmptyRecovery = [
            ...previousNativeSelections,
            nativePairLabels[0],
            nativePairLabels[0],
        ];
        await readNativeSelection(beforeEmptyRecovery);

        await openWithoutHighlight();
        await page.keyboard.press('ArrowDown');
        const previousResult = await activeNativeOption(0);
        const nativeEmptyQuery = 'No native matches';
        await typeNativeQuery(nativeEmptyQuery);
        await nativeDialog
            .getByText('No matching values.', { exact: true })
            .waitFor();
        assert.equal(await nativeOptions.count(), 0);
        assert.equal(
            await nativeSearch.getAttribute('aria-activedescendant'),
            null
        );
        await page.keyboard.press('Enter');
        await focus(nativeSearch);
        await readNativeSelection(beforeEmptyRecovery);

        const recoveredFirst = await replaceWithPair();
        assert.notEqual(recoveredFirst, previousResult);
        await page.keyboard.press('ArrowDown');
        const advancedSecond = await activeNativeOption(1);
        assert.notEqual(advancedSecond, recoveredFirst);
        await page.keyboard.press('Enter');
        await nativeDialog.waitFor({ state: 'hidden' });
        await focus(nativeTrigger);
        await readNativeSelection([
            ...beforeEmptyRecovery,
            nativePairLabels[1],
        ]);
        assert.equal(await draft.inputValue(), 'masked-signup@example.invalid');
        evidence.nativeLoginCombobox.typedReplacement = {
            query: nativePairQuery,
            emptyQuery: nativeEmptyQuery,
            highlighted: {
                enter: enterHighlighted,
                tab: tabHighlighted,
                recovery: recoveredFirst,
                afterArrowDown: advancedSecond,
            },
            selections: (await read()).selections.slice(
                proof.selections.length + previousNativeSelections.length
            ),
        };
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpectedRequests, []);
        Object.assign(evidence, proof, {
            passed: true,
            pageErrors,
            unexpectedRequests,
        });
    } finally {
        try {
            await context?.close();
            evidence.contextClosed = true;
        } finally {
            rmSync(scratch, { recursive: true, force: true });
            evidence.scratchRemoved = true;
            writeFileSync(
                join(output, 'login-existing-values-browser.json'),
                JSON.stringify(evidence, null, 2)
            );
        }
    }
}
