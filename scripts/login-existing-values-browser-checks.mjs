import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const fixture = String.raw`
import React, { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LoginExistingValuesPicker, LoginSignupConfirmationDialog } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/login-existing-values-picker.css';

const duplicate = '  duplicate@example.com  ';
const first = { labels: [duplicate, '', duplicate], offset: 'raw-page-2' };
const second = { labels: ['', duplicate, 'Last option'], offset: null };
const calls = [];
const selections = [];
const trusted = [];
const settingsActivations = [];
const signupDraft = 'masked-signup@example.invalid';
const unmaskedDraft = 'visible-signup@example.invalid';
let signupCancels = 0;
const signupCreates = [];
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
        signup: null,
        signupAttempt: 'A',
        signupDisabled: false,
    });
    update = (patch) => flushSync(() => setState(current => ({ ...current, ...patch })));
    return h('form', {
        onSubmit(event) { event.preventDefault(); submits++; },
    },
    h('label', null, 'Sign-in value', h('input', { type: 'password', defaultValue: signupDraft })),
    h('button', { type: 'button', onClick: () => update({ signup: 'masked' }) }, 'Confirm masked signup'),
    h('button', { type: 'button', onClick: () => update({ signup: 'visible' }) }, 'Confirm visible signup'),
    h(LoginSignupConfirmationDialog, {
        open: state.signup !== null,
        attemptId: state.signupAttempt,
        disabled: state.signupDisabled,
        copy: {
            title: (state.signup === 'masked' ? '••••••••' : unmaskedDraft) + ' n’existe pas',
            body: 'Vérifiez la valeur ou créez un nouvel enregistrement.',
            back: 'Retour',
            create: 'Créer',
        },
        onCancel() { signupCancels++; update({ signup: null }); },
        onCreate() { signupCreates.push(state.signupAttempt); },
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
        labels: { title: 'Valeurs existantes', error: 'Values unavailable' },
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
    }));
}
document.addEventListener('click', event => {
    if (event.target.closest('[role=dialog] li button')) trusted.push(event.isTrusted);
});
createRoot(document.querySelector('main')).render(h(StrictMode, null, h(App)));
window.pickerProof = {
    update: (patch) => update(patch),
    release: () => release({ labels: ['Retired owner result'], offset: 'old-page' }),
    snapshot: () => ({ react: React.version, selections, calls, submits, trusted, settingsActivations, signupCancels, signupCreates }),
};
`;

export async function checkLoginExistingValuesBrowser({
    browser,
    consumer,
    evidence,
    output,
    expectedReactVersion,
}) {
    const scratch = mkdtempSync(join(consumer, '.login-picker-browser-'));
    let context;
    const pageErrors = [];
    const unexpectedRequests = [];
    try {
        const entry = join(scratch, 'entry.mjs');
        writeFileSync(entry, fixture);
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
                path.endsWith('/react/LoginExistingValuesPicker.js')
            )
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/react/login-existing-values-picker.css')
            )
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/react/LoginSignupConfirmationDialog.js')
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
