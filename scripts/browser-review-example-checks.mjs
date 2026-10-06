import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import {
    createReviewFixture,
    createHideEmptyReviewFixture,
} from './build-privacy-browser-proof.mjs';

const waitFor = async (predicate) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Packed review starter did not reach its expected state.');
};
const settled = async () => {
    for (let turn = 0; turn < 6; turn++)
        await new Promise((resolve) => setImmediate(resolve));
};
const button = (document, text) => {
    const matches = [...document.querySelectorAll('button')].filter(
        (node) => node.textContent.trim() === text
    );
    assert.equal(
        matches.length,
        1,
        `Expected one actual starter ${text} button.`
    );
    return matches[0];
};

/** Exact installed package + copied complete starter, with synthetic transport. */
export async function checkBrowserReviewExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(consumer, '.generated/review-main-checks.mjs');
    const bundled = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(bundled.metafile, consumer);
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('src/review.ts')
        )
    );
    const scenarios = [
        'answers',
        'confirmed-draft-revision',
        'confirmed-owner-aba',
        'confirmed-reload',
        'validation',
        'unknown-transport',
        'cancelled-held',
        'unsupported-section',
    ];
    for (const [revision, scenario] of scenarios.entries()) {
        const fixture = createReviewFixture(
            scenario === 'validation'
                ? 'review-validation'
                : scenario === 'cancelled-held'
                  ? 'review-unknown'
                  : 'review-answers'
        );
        const form = fixture.page();
        if (scenario === 'unsupported-section') {
            form.payload.fieldIdsToSchemas.fld_review_readonly.miniExtConfig.headerSectionTitle =
                'Retained section';
            form.payload.fieldIdsToSchemas.fld_review_readonly.miniExtConfig.enableSectionHeader = false;
            form.payload.fieldIdsToSchemas.fld_review_readonly.miniExtConfig.hideFieldIfEmpty = true;
        }
        const initial = structuredClone(form.payload.formRecord.data);
        const window = new Window({
            url: 'https://review-starter.example.test',
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        window.document.write(
            readFileSync(join(consumer, 'index.html'), 'utf8').replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/g,
                ''
            )
        );
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            const response = await fixture.fetch(input, init);
            if (url.searchParams.get('route') === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(form));
            if (scenario === 'unknown-transport')
                throw new Error('Synthetic unknown review transport outcome.');
            return response;
        };
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            await import(`${pathToFileURL(outfile).href}?review=${revision}`);
            const document = window.document;
            const submit = () =>
                document
                    .querySelector('input[data-field-id="fld_review_title"]')
                    .closest('form')
                    .dispatchEvent(
                        new window.Event('submit', {
                            bubbles: true,
                            cancelable: true,
                        })
                    );
            const field = (id) =>
                document.querySelector(`[data-field-id="${id}"]`);
            const edit = (id, value) => {
                const input = field(id);
                input.value = value;
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            };
            const saves = () =>
                fixture.state.calls.filter((call) => call.route === 'saveForm');
            const open = async () => {
                submit();
                await waitFor(
                    () =>
                        document.querySelector(
                            'dialog[data-form-review][open]'
                        ) !== null
                );
                const dialog = document.querySelector(
                    'dialog[data-form-review][open]'
                );
                assert.equal(document.activeElement, button(dialog, 'Edit'));
                assert.equal(
                    document.querySelector('#screen .fields').inert,
                    true
                );
                assert.equal(dialog.querySelectorAll('img,b,a').length, 0);
                return dialog;
            };
            document.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            document.getElementById('share-id').value =
                'privacy_share_synthetic';
            document.getElementById('connection-form').dispatchEvent(
                new window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(() => field('fld_review_title') !== null);
            assert.equal(saves().length, 0);
            if (scenario === 'unsupported-section') {
                submit();
                await settled();
                assert.equal(document.querySelector('dialog'), null);
                assert.match(
                    document.getElementById('status').textContent,
                    /unavailable|blocked/i
                );
                assert.equal(saves().length, 0);
            } else if (scenario === 'answers') {
                edit('fld_review_title', 'SecondExactReviewSecret');
                edit('fld_review_conditional', 'Edited conditional answer');
                field('fld_review_show').checked = false;
                field('fld_review_show').dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                let dialog = await open();
                assert.deepEqual(
                    [...dialog.querySelectorAll('dt')].map(
                        (node) => node.textContent
                    ),
                    [
                        '<b>Semantic secret</b>',
                        'Plain readonly answer',
                        'Plain URL answer',
                        'Zero count',
                    ]
                );
                assert.deepEqual(
                    [...dialog.querySelectorAll('dd')].map(
                        (node) => node.textContent
                    ),
                    [
                        '••••••••',
                        initial.fld_review_readonly,
                        initial.fld_review_url,
                        '0',
                    ]
                );
                assert.equal(
                    dialog.textContent.includes('SecondExactReviewSecret'),
                    false
                );
                assert.equal(
                    dialog
                        .querySelector('dt')
                        .getAttribute('data-review-title-hidden'),
                    'true'
                );
                for (const label of dialog.querySelectorAll('dt'))
                    assert.equal(
                        label.nextElementSibling.getAttribute(
                            'aria-labelledby'
                        ),
                        label.id
                    );
                button(dialog, 'Edit').click();
                await settled();
                assert.equal(saves().length, 0);
                dialog = await open();
                dialog.dispatchEvent(
                    new window.Event('cancel', { cancelable: true })
                );
                await settled();
                assert.equal(saves().length, 0);
                dialog = await open();
                const confirm = button(dialog, 'Confirm');
                confirm.click();
                confirm.click();
                submit();
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                await settled();
                assert.equal(saves().length, 1);
                assert.deepEqual(saves()[0].input.formRecord, {
                    type: 'edit',
                    tableId: fixture.state.expected.tableId,
                    recordId: fixture.state.expected.recordId,
                    data: {
                        ...initial,
                        fld_review_title: 'SecondExactReviewSecret',
                        fld_review_conditional: 'Edited conditional answer',
                        fld_review_show: false,
                    },
                });
                assert.deepEqual(
                    [...saves()[0].input.formFieldIdsWithUnsavedChanges].sort(),
                    [
                        'fld_review_title',
                        'fld_review_conditional',
                        'fld_review_show',
                    ].sort()
                );
                assert.equal(saves()[0].input.isComputeMode, false);
                assert.deepEqual(saves()[0].input.context, {
                    type: 'direct-url',
                });
                assert.equal(document.querySelector('dialog'), null);
            } else if (scenario.startsWith('confirmed-')) {
                const originalControl = field('fld_review_title');
                const dialog = await open();
                // Resolve the decision first, then change the actual starter
                // in the same turn before its await continuation dispatches.
                button(dialog, 'Confirm').click();
                if (scenario === 'confirmed-draft-revision') {
                    edit('fld_review_title', 'Different accepted answer');
                    edit('fld_review_title', initial.fld_review_title);
                } else if (scenario === 'confirmed-owner-aba') {
                    for (const identity of ['B', 'A']) {
                        document.getElementById('visitor').value = identity;
                        document
                            .getElementById('visitor')
                            .dispatchEvent(
                                new window.Event('change', { bubbles: true })
                            );
                    }
                } else button(document, 'Reload').click();
                await settled();
                await waitFor(() => field('fld_review_title') !== null);
                assert.equal(saves().length, 0);
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(
                    field('fld_review_title').value,
                    initial.fld_review_title
                );
                if (scenario !== 'confirmed-draft-revision')
                    assert.notEqual(field('fld_review_title'), originalControl);
                const fresh = await open();
                button(fresh, 'Confirm').click();
                await waitFor(() => saves().length === 1);
                assert.equal(
                    saves()[0].input.formRecord.data.fld_review_title,
                    initial.fld_review_title
                );
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    scenario === 'confirmed-draft-revision'
                        ? ['fld_review_title']
                        : []
                );
            } else if (scenario === 'validation') {
                const dialog = await open();
                assert.equal(
                    [...dialog.querySelectorAll('dt')].some(
                        (node) =>
                            node.dataset.reviewFieldId === 'fld_review_title'
                    ),
                    false
                );
                button(dialog, 'Confirm').click();
                await waitFor(() =>
                    document
                        .querySelector('.error-list')
                        .textContent.includes(
                            fixture.state.expected.validationMessage
                        )
                );
                assert.equal(saves().length, 1);
                assert.deepEqual(saves()[0].input.formRecord.data, initial);
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    []
                );
                assert.equal(field('fld_review_title').value, '');
                edit('fld_review_title', 'Repaired required answer');
                button(await open(), 'Edit').click();
                await settled();
                assert.equal(saves().length, 1);
                assert.equal(
                    field('fld_review_title').value,
                    'Repaired required answer'
                );
            } else {
                button(await open(), 'Confirm').click();
                await waitFor(() => saves().length === 1);
                if (scenario === 'cancelled-held') {
                    await waitFor(() => fixture.state.pending.length === 1);
                    button(document, 'Cancel request').click();
                    await settled();
                    assert.equal(fixture.state.abortCounts.save, 1);
                    const release = fixture.addressControls.find(
                        ([label]) => label === 'Release held review Save'
                    );
                    assert(release, 'late-response release control is present');
                    release[1]();
                }
                await waitFor(
                    () =>
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                await settled();
                submit();
                await settled();
                assert.equal(saves().length, 1);
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(button(document, 'Save').disabled, true);
                assert.equal(
                    field('fld_review_title').closest('.fields').inert,
                    true,
                    'settled unknown/cancelled Review Save retains recovery inertness'
                );
                assert.equal(
                    field('fld_review_title').value,
                    initial.fld_review_title
                );
                assert.deepEqual(saves()[0].input.formRecord.data, initial);
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    []
                );
                if (scenario === 'unknown-transport')
                    assert.match(
                        document.querySelector('.error-list').textContent,
                        /may have completed/
                    );
                else {
                    assert.deepEqual(
                        fixture.state.events.filter(
                            (event) => event.type === 'review-save-released'
                        ),
                        [{ type: 'review-save-released', id: 'review-save-1' }]
                    );
                    assert.deepEqual(
                        fixture.state.events.filter(
                            (event) => event.type === 'review-save-settled'
                        ),
                        [
                            {
                                type: 'review-save-settled',
                                id: 'review-save-1',
                                aborted: true,
                            },
                        ]
                    );
                }
            }
            assert.deepEqual(fixture.state.unexpected, []);
            assert.deepEqual(form.payload.formRecord.data, initial);
            assert.equal(
                fixture.state.calls.filter((call) => call.route !== 'saveForm')
                    .length,
                scenario === 'confirmed-reload' ? 2 : 1
            );
            console.log(
                `[packed review ${revision + 1}/${scenarios.length}] ${scenario}: passed`
            );
        } catch (error) {
            throw new Error(`Packed review scenario failed: ${scenario}`, {
                cause: error,
            });
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    }
    return { checks: scenarios.length };
}

/** Actual copied starter: hidden canonical blanks compose with current Review. */
export async function checkBrowserCombinedEmptyReviewExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(
        consumer,
        '.generated/combined-empty-review-checks.mjs'
    );
    const bundled = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(bundled.metafile, consumer);
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('src/review.ts')
        )
    );
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('dist/esm/forms/visibility.js')
        )
    );
    for (const [index, scenario] of [
        'hide-empty-review',
        'hide-empty-review-malformed',
    ].entries()) {
        const fixture = createHideEmptyReviewFixture(scenario);
        const initial = structuredClone(fixture.state.expected.initial);
        const window = new Window({
            url: 'https://combined-review.example.test',
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        window.document.write(
            readFileSync(join(consumer, 'index.html'), 'utf8').replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/g,
                ''
            )
        );
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            fetch: fixture.fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            await import(`${pathToFileURL(outfile).href}?combined=${index}`);
            const doc = window.document;
            const field = (id) => {
                const control = doc.querySelector(`[data-field-id="${id}"]`);
                assert(control);
                return control;
            };
            const saves = () =>
                fixture.state.calls.filter((call) => call.route === 'saveForm');
            const submit = () =>
                field('fld_empty_tail')
                    .closest('form')
                    .dispatchEvent(
                        new window.Event('submit', {
                            bubbles: true,
                            cancelable: true,
                        })
                    );
            const open = async () => {
                submit();
                await waitFor(
                    () =>
                        doc.querySelector('dialog[data-form-review][open]') !==
                        null
                );
                const dialog = doc.querySelector(
                    'dialog[data-form-review][open]'
                );
                assert.equal(doc.activeElement, button(dialog, 'Edit'));
                assert.equal(doc.querySelector('#screen .fields').inert, true);
                assert.deepEqual(
                    [...dialog.querySelectorAll('dt')].map(
                        (node) => node.dataset.reviewFieldId
                    ),
                    ['fld_empty_locked', 'fld_empty_tail']
                );
                assert.deepEqual(
                    [...dialog.querySelectorAll('dd')].map(
                        (node) => node.textContent
                    ),
                    [
                        'Retained readonly native answer',
                        'Accepted combined sibling',
                    ]
                );
                assert.equal(dialog.querySelectorAll('img,b,a').length, 0);
                for (const label of dialog.querySelectorAll('dt'))
                    assert.equal(
                        label.nextElementSibling.getAttribute(
                            'aria-labelledby'
                        ),
                        label.id
                    );
                return dialog;
            };
            doc.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            doc.getElementById('share-id').value = 'privacy_share_synthetic';
            doc.getElementById('connection-form').dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
            await waitFor(
                () =>
                    doc.querySelector('[data-field-id="fld_empty_tail"]') !==
                        null &&
                    doc.getElementById('screen').getAttribute('aria-busy') ===
                        'false'
            );
            assert.equal(
                doc.querySelectorAll('#screen [data-field-id]').length,
                13
            );
            for (const id of fixture.state.expected.blankFieldIds) {
                const shown = field(id).closest('[hidden]') === null;
                assert.equal(
                    shown,
                    scenario === 'hide-empty-review-malformed' &&
                        id === 'fld_empty_barcode'
                );
            }
            assert.equal(field('fld_empty_locked').disabled, true);
            assert.equal(
                doc.querySelector('form.card > p[role="alert"]').hidden,
                true
            );
            assert.equal(saves().length, 0);
            field('fld_empty_tail').value = 'Accepted combined sibling';
            field('fld_empty_tail').dispatchEvent(
                new window.Event('input', { bubbles: true })
            );
            if (scenario === 'hide-empty-review-malformed') {
                submit();
                await waitFor(() =>
                    doc
                        .getElementById('status')
                        .textContent.includes('Review is unavailable')
                );
                assert.equal(doc.querySelector('dialog'), null);
                assert.equal(saves().length, 0);
                assert.equal(doc.querySelector('#screen .fields').inert, false);
                assert.equal(
                    doc.querySelector('form.card > p[role="alert"]').hidden,
                    true
                );
                assert.equal(
                    field('fld_empty_barcode').value,
                    initial.fld_empty_barcode
                );
                assert.equal(
                    field('fld_empty_tail').value,
                    'Accepted combined sibling'
                );
                assert.equal(
                    doc
                        .getElementById('status')
                        .textContent.includes('PrivateCombinedMalformed'),
                    false
                );
                await settled();
                assert.equal(saves().length, 0);
                assert.deepEqual(
                    fixture.state.calls.map((call) => call.route),
                    ['fetchExtensionForEndUser']
                );
            } else {
                let dialog = await open();
                assert.equal(saves().length, 0);
                button(dialog, 'Edit').click();
                await settled();
                assert.equal(saves().length, 0);
                assert.equal(doc.querySelector('dialog'), null);
                assert.equal(
                    field('fld_empty_tail').value,
                    'Accepted combined sibling'
                );
                dialog = await open();
                dialog.dispatchEvent(
                    new window.Event('cancel', { cancelable: true })
                );
                await settled();
                assert.equal(saves().length, 0);
                assert.equal(doc.querySelector('dialog'), null);
                dialog = await open();
                button(dialog, 'Confirm').click();
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        doc
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false' &&
                        doc
                            .getElementById('status')
                            .textContent.includes('validation errors')
                );
                await settled();
                assert.equal(saves().length, 1);
                const call = saves()[0];
                assert.equal(call.method, 'POST');
                assert.equal(
                    call.input.extensionAccessToken,
                    'FAKE_SYNTHETIC_HIDE_EMPTY_TOKEN'
                );
                assert.deepEqual(call.input.formRecord, {
                    type: 'edit',
                    tableId: fixture.state.expected.tableId,
                    recordId: fixture.state.expected.recordId,
                    data: {
                        ...initial,
                        fld_empty_tail: 'Accepted combined sibling',
                    },
                });
                assert.deepEqual(call.input.formFieldIdsWithUnsavedChanges, [
                    ...fixture.state.expected.blankFieldIds,
                    'fld_empty_tail',
                ]);
                assert.deepEqual(call.input.context, { type: 'direct-url' });
                assert.equal(call.input.isComputeMode, false);
                assert.deepEqual(
                    call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
                    {}
                );
                assert(
                    doc
                        .querySelector('.error-list')
                        .textContent.includes(
                            `Hidden required answer: ${fixture.state.expected.validationMessage}`
                        )
                );
                assert.equal(doc.querySelector('dialog'), null);
                assert.deepEqual(
                    fixture.state.calls.map((entry) => entry.route),
                    ['fetchExtensionForEndUser', 'saveForm']
                );
            }
            assert.deepEqual(fixture.state.expected.initial, initial);
            assert.deepEqual(fixture.state.unexpected, []);
            assert(
                fixture.state.calls.every(
                    (call) => call.credentialsMode === 'omit'
                )
            );
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    }
    return { checks: 2 };
}
