import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { addSelectReviewAnswers } from './form-review-recipe-checks.mjs';
import { addLinkedReviewAnswers } from './linked-review-recipe-checks.mjs';

export function addAttachmentReviewAnswers(page) {
    const stored = {
        id: 'att_stored',
        url: 'https://files.invalid/PRIVATE_STORED_URL',
        filename: 'PRIVATE_STORED_NAME',
        size: 500,
        thumbnails: {
            full: {
                url: 'https://files.invalid/PRIVATE_THUMB',
                width: 1,
                height: 1,
            },
        },
    };
    const added = {
        id: null,
        url: 'https://files.invalid/PRIVATE_NEW_URL',
        filename: '<b>Exact filename</b>',
        type: 'text/plain',
        size: 3,
    };
    for (const [id, config, values] of [
        [
            'fld_review_files',
            {
                hideAttachmentName: false,
                addOnlyMode: true,
                showExistingValuesForAddOnlyMode: false,
            },
            [stored, added, added],
        ],
        ['fld_review_private_files', { hideAttachmentName: true }, [stored]],
    ]) {
        page.payload.fieldIdsInForm.push(id);
        page.payload.fieldIdsToSchemas[id] = {
            fieldType: 'multipleAttachments',
            airtableField: {
                id,
                name: id,
                isComputed: false,
                config: {
                    type: 'multipleAttachments',
                    options: { isReversed: false },
                },
            },
            miniExtConfig: config,
        };
        page.payload.formRecord.data[id] = structuredClone(values);
    }
    page.payload.persistedAddOnlyAttachmentValuesByFieldId = {
        fld_review_files: [structuredClone(stored)],
    };
    return { stored, added };
}

export function assertAttachmentReviewMatrix(review, createFormSaveInput) {
    const page = createReviewFixture('review-answers').page();
    addAttachmentReviewAnswers(page);
    const before = structuredClone(page);
    const id = 'fld_review_files';
    const rows = (p = page, data = p.payload.formRecord.data) =>
        review(p, data).filter((row) => row.fieldId === id);
    assert.equal(
        rows()[0].value,
        '<b>Exact filename</b>\n<b>Exact filename</b>'
    );
    const generic = 'Attachment — filename unavailable';
    let checks = 1;
    for (const empty of [null, undefined, '', ' \t ', []]) {
        const p = structuredClone(page);
        delete p.payload.persistedAddOnlyAttachmentValuesByFieldId;
        assert.deepEqual(
            rows(p, { ...p.payload.formRecord.data, [id]: empty }),
            []
        );
        checks++;
    }
    for (const flag of [undefined, true, false, null, 'false']) {
        const p = structuredClone(page);
        p.payload.fieldIdsToSchemas[id].miniExtConfig.hideAttachmentName = flag;
        assert.equal(
            rows(p)[0].value,
            Array(2)
                .fill(flag === false ? '<b>Exact filename</b>' : generic)
                .join('\n')
        );
        checks++;
    }
    for (const value of [
        {},
        'PRIVATE_BAD',
        [null],
        [1],
        new Array(1),
        [{ url: '' }],
        [{ url: 'private', filename: null }],
        [{ url: 'private', size: '1' }],
    ]) {
        assert.throws(
            () => rows(page, { ...page.payload.formRecord.data, [id]: value }),
            (error) =>
                error.message.startsWith('Review is unavailable') &&
                !error.message.includes('PRIVATE')
        );
        checks++;
    }
    for (const baseline of [
        undefined,
        null,
        [],
        { [id]: null },
        { [id]: undefined },
        { [id]: [null] },
    ]) {
        const p = structuredClone(page);
        p.payload.persistedAddOnlyAttachmentValuesByFieldId = baseline;
        assert.throws(() => rows(p), /Review is unavailable/);
        checks++;
    }
    const absent = structuredClone(page);
    absent.payload.persistedAddOnlyAttachmentValuesByFieldId = {};
    assert.equal(
        rows(absent)[0].value,
        'PRIVATE_STORED_NAME\n<b>Exact filename</b>\n<b>Exact filename</b>'
    );
    checks++;
    const hidden = structuredClone(page);
    hidden.payload.formRecord.data[id] = [
        hidden.payload.formRecord.data[id][0],
    ];
    assert.deepEqual(rows(hidden), []);
    checks++;
    for (const config of [
        {
            allowedFiles: 0,
            sizeLimit: 0.00001,
            allowedAttachmentTypes: ['images'],
        },
        { fieldMode: 'upload-url' },
        { fieldMode: 'hand-signature' },
        { readOnly: true },
    ]) {
        const p = structuredClone(page);
        Object.assign(p.payload.fieldIdsToSchemas[id].miniExtConfig, config);
        assert(
            rows(p).length === 1,
            'existing answers are not upload admission'
        );
        checks++;
    }
    const saved = createFormSaveInput({
        loaded: page,
        draft: { data: page.payload.formRecord.data, dirtyFieldIds: [id] },
        options: {
            context: { type: 'direct-url' },
            isComputeMode: false,
            captchaVal: null,
            searchQuery: {},
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    assert.deepEqual(saved.formRecord, page.payload.formRecord);
    assert.deepEqual(saved.formFieldIdsWithUnsavedChanges, [id]);
    assert.deepEqual(page, before);
    return checks + 1;
}

const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Actual attachment starter did not reach expected state.');
};
const settled = async () => {
    for (let i = 0; i < 8; i++)
        await new Promise((resolve) => setImmediate(resolve));
};

/** Installed recipe and entire copied starter; synthetic requests only. */
export async function checkAttachmentReviewRecipe({
    consumerDirectory: consumer,
    happyDomModulePath,
}) {
    for (const name of ['main.ts', 'review.ts', 'pendingFiles.ts'])
        assert.deepEqual(
            readFileSync(join(consumer, 'src', name)),
            readFileSync(
                join(
                    consumer,
                    'node_modules/@miniextensions/sdk/examples/browser/src',
                    name
                )
            )
        );
    const entry = join(consumer, '.generated/attachment-review-entry.ts');
    writeFileSync(
        entry,
        "export { prepareFormReviewRows } from '../src/review.js';\nexport { createFormSaveInput } from '@miniextensions/sdk/forms';\n"
    );
    const outfile = join(consumer, '.generated/attachment-review-recipe.mjs');
    const recipe = await build({
        absWorkingDir: consumer,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        metafile: true,
        logLevel: 'silent',
    });
    await assertBrowserInputs(recipe.metafile, consumer);
    assert(
        Object.keys(recipe.metafile.inputs).some((path) =>
            path.endsWith('dist/esm/forms/attachments.js')
        )
    );
    const { prepareFormReviewRows, createFormSaveInput } = await import(
        pathToFileURL(outfile).href
    );
    const matrixChecks = assertAttachmentReviewMatrix(
        prepareFormReviewRows,
        createFormSaveInput
    );
    const main = join(consumer, '.generated/attachment-review-main.mjs');
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: main,
        metafile: true,
        logLevel: 'silent',
        plugins: [
            {
                name: 'accepted-scope-observer',
                setup(build) {
                    build.onLoad({ filter: /\/src\/main\.ts$/ }, (args) => ({
                        loader: 'ts',
                        contents:
                            readFileSync(args.path, 'utf8').replace(
                                '    const readFilterMetadata = (context:',
                                '    attachmentObserveForTest = () => updateFormActivity();\n    const readFilterMetadata = (context:'
                            ) +
                            '\nlet attachmentObserveForTest: () => void;\nexport const observeAttachmentConfigurationForTest = () => attachmentObserveForTest();\nexport const attachmentPageForTest = () => visitors[activeVisitor].screen;\n',
                    }));
                },
            },
        ],
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    assert(
        Object.keys(bundle.metafile.inputs).some((path) =>
            path.endsWith('src/pendingFiles.ts')
        )
    );
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const scenarios = [
        'mixed',
        'pending-clear',
        'hidden-clear',
        'upload',
        'upload-replacement',
        'upload-cancel',
        'upload-error',
        'upload-stale',
        'pending-aba',
        'baseline-aba',
        'config-aba',
        'draft-aba',
        'owner-aba',
        'custom-title-clear',
        'dispose-observer',
        ...[
            'missing',
            'null',
            'blank',
            'array',
            'bad-value',
            'bad-baseline',
            'missing-baseline',
            'all-hidden',
            'over-capacity',
            'non-upload-mode',
            'filename-default',
            'filename-true',
            'filename-blank',
        ].map((name) => `matrix-${name}`),
    ];
    for (const [index, scenario] of scenarios.entries()) {
        const fixture = createReviewFixture('review-answers');
        const page = fixture.page();
        addSelectReviewAnswers(page);
        addLinkedReviewAnswers(page);
        addAttachmentReviewAnswers(page);
        if (scenario === 'custom-title-clear' || scenario === 'hidden-clear') {
            page.payload.fieldIdsToSchemas.fld_review_files.airtableField.name =
                'PRIVATE_RAW_ATTACHMENT_TITLE';
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig.title =
                'Configured attachment title';
        }
        if (scenario === 'hidden-clear')
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig.conditionalFields =
                structuredClone(
                    page.payload.fieldIdsToSchemas.fld_review_conditional
                        .miniExtConfig.conditionalFields
                );
        const attachmentConfig =
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig;
        if (scenario === 'matrix-missing')
            delete page.payload.formRecord.data.fld_review_files;
        if (scenario === 'matrix-null')
            page.payload.formRecord.data.fld_review_files = null;
        if (scenario === 'matrix-blank')
            page.payload.formRecord.data.fld_review_files = ' \t ';
        if (scenario === 'matrix-array')
            page.payload.formRecord.data.fld_review_files = [];
        if (scenario === 'matrix-bad-value')
            page.payload.formRecord.data.fld_review_files = [null];
        if (scenario === 'matrix-bad-baseline')
            page.payload.persistedAddOnlyAttachmentValuesByFieldId.fld_review_files =
                null;
        if (scenario === 'matrix-missing-baseline')
            delete page.payload.persistedAddOnlyAttachmentValuesByFieldId;
        if (scenario === 'matrix-all-hidden')
            page.payload.formRecord.data.fld_review_files =
                page.payload.formRecord.data.fld_review_files.slice(0, 1);
        if (scenario === 'matrix-over-capacity')
            Object.assign(attachmentConfig, {
                allowedFiles: 0,
                sizeLimit: 0.00001,
                allowedAttachmentTypes: ['images'],
            });
        if (scenario === 'matrix-non-upload-mode')
            attachmentConfig.fieldMode = 'upload-url';
        if (scenario === 'matrix-filename-default')
            delete attachmentConfig.hideAttachmentName;
        if (scenario === 'matrix-filename-true')
            attachmentConfig.hideAttachmentName = true;
        if (scenario === 'matrix-filename-blank')
            for (const row of page.payload.formRecord.data.fld_review_files)
                row.filename = ' \t ';
        const initial = structuredClone(page.payload.formRecord.data);
        const window = new Window({
            url: 'https://attachment-review.invalid',
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
        const calls = [];
        let releaseUpload;
        const uploadGate = new Promise((resolve) => {
            releaseUpload = resolve;
        });
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            fetch: async (input, init = {}) => {
                const url = new URL(String(input));
                const route =
                    url.searchParams.get('route') ??
                    (url.pathname ===
                    '/api/trpc/publicExtensions.createPublicUploadLink'
                        ? 'createPublicUploadLink'
                        : null);
                calls.push({
                    route: route ?? 'PUT',
                    method: init.method,
                    input:
                        init.body && typeof init.body === 'string'
                            ? JSON.parse(init.body)
                            : null,
                });
                if (route === 'fetchExtensionForEndUser')
                    return new Response(JSON.stringify(page));
                if (route === 'createPublicUploadLink')
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    signedUrl:
                                        'https://attachment-put.invalid/PRIVATE',
                                    publicUrl:
                                        'https://files.invalid/PRIVATE_UPLOADED',
                                },
                            },
                        })
                    );
                if (url.origin === 'https://attachment-put.invalid') {
                    await uploadGate;
                    if (scenario === 'upload-error')
                        throw new Error('Synthetic upload failure');
                    return new Response('', { status: 200 });
                }
                if (route === 'saveForm')
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                assert.fail(`Unexpected synthetic route ${route}`);
            },
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            const probe = await import(
                `${pathToFileURL(main).href}?attachment=${index}`
            );
            const document = window.document;
            const button = (label, within = document) => {
                const found = [...within.querySelectorAll('button')].filter(
                    (node) => node.textContent.trim() === label
                );
                assert.equal(found.length, 1, label);
                return found[0];
            };
            document.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            document.getElementById('share-id').value = 'attachment_synthetic';
            document.getElementById('connection-form').dispatchEvent(
                new window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(
                () =>
                    document.querySelector(
                        'input[data-pending-field-id="fld_review_files"]'
                    ) != null
            );
            const file = document.querySelector(
                'input[data-pending-field-id="fld_review_files"]'
            );
            const field = (id) =>
                document.querySelector(`[data-field-id="${id}"]`);
            const edit = (id, value) => {
                field(id).value = value;
                field(id).dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            };
            const setFile = (name = 'new-file.txt') => {
                const transfer = new window.DataTransfer();
                transfer.items.add(
                    new window.File(['abc'], name, { type: 'text/plain' })
                );
                file.files = transfer.files;
                file.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                return file.files[0];
            };
            const formNode = field('fld_review_title').closest('form');
            const submit = () =>
                formNode.dispatchEvent(
                    new window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
            const open = async () => {
                submit();
                await waitFor(
                    () => document.querySelector('dialog[open]') != null
                );
                return document.querySelector('dialog[open]');
            };
            const saves = () =>
                calls.filter((call) => call.route === 'saveForm');
            const clear = () => button('Clear pending files').click();
            const expected = structuredClone(initial);
            if (scenario.startsWith('matrix-')) {
                const beforeRequests = calls.length;
                if (
                    [
                        'matrix-bad-value',
                        'matrix-bad-baseline',
                        'matrix-missing-baseline',
                    ].includes(scenario)
                ) {
                    submit();
                    await settled();
                    assert.equal(document.querySelector('dialog'), null);
                    assert(
                        document
                            .getElementById('status')
                            .textContent.startsWith('Review is unavailable')
                    );
                    assert(
                        !document
                            .getElementById('status')
                            .textContent.includes('PRIVATE')
                    );
                    assert.equal(calls.length, beforeRequests);
                    assert.equal(saves().length, 0);
                } else {
                    const dialog = await open();
                    const label = dialog.querySelector(
                        '[data-review-field-id="fld_review_files"]'
                    );
                    if (
                        [
                            'matrix-missing',
                            'matrix-null',
                            'matrix-blank',
                            'matrix-array',
                            'matrix-all-hidden',
                        ].includes(scenario)
                    )
                        assert.equal(label, null);
                    else
                        assert.equal(
                            label.nextElementSibling.textContent,
                            Array(2)
                                .fill(
                                    [
                                        'matrix-filename-default',
                                        'matrix-filename-true',
                                        'matrix-filename-blank',
                                    ].includes(scenario)
                                        ? 'Attachment — filename unavailable'
                                        : '<b>Exact filename</b>'
                                )
                                .join('\n')
                        );
                    assert.equal(calls.length, beforeRequests);
                    button('Confirm', dialog).click();
                    await waitFor(() => saves().length === 1);
                    assert.deepEqual(saves()[0].input.formRecord, {
                        ...page.payload.formRecord,
                        data: expected,
                    });
                    assert.deepEqual(
                        saves()[0].input.formFieldIdsWithUnsavedChanges,
                        []
                    );
                }
            } else if (scenario === 'mixed') {
                edit('fld_review_title', 'Edited secret');
                expected.fld_review_title = 'Edited secret';
                const dialog = await open();
                assert.equal(
                    dialog.querySelector(
                        '[data-review-field-id="fld_review_files"]'
                    ).nextElementSibling.textContent,
                    '<b>Exact filename</b>\n<b>Exact filename</b>'
                );
                assert.equal(
                    dialog.querySelector(
                        '[data-review-field-id="fld_review_private_files"]'
                    ).nextElementSibling.textContent,
                    'Attachment — filename unavailable'
                );
                assert(!dialog.textContent.includes('PRIVATE'));
                for (const node of [dialog, ...dialog.querySelectorAll('*')])
                    for (const attribute of node.attributes)
                        assert(!attribute.value.includes('PRIVATE'));
                assert.equal(
                    dialog.querySelectorAll('a,img,video,audio').length,
                    0
                );
                assert.equal(calls.length, 1, 'Review makes no requests');
                button('Edit', dialog).click();
                await settled();
                assert.equal(saves().length, 0);
                const escaped = await open();
                escaped.dispatchEvent(
                    new window.Event('cancel', { cancelable: true })
                );
                await settled();
                assert.equal(saves().length, 0);
                button('Confirm', await open()).click();
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assert.deepEqual(saves()[0].input.formRecord, {
                    ...page.payload.formRecord,
                    data: expected,
                });
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    ['fld_review_title']
                );
            } else if (
                [
                    'pending-clear',
                    'hidden-clear',
                    'custom-title-clear',
                ].includes(scenario)
            ) {
                const clearControl = button('Clear pending files');
                assert.equal(
                    clearControl.hidden,
                    true,
                    'no selection means no clear action'
                );
                setFile();
                assert.equal(clearControl.hidden, false);
                const panel = clearControl.closest(
                    '[aria-label="Pending attachment selections"]'
                );
                assert(
                    !panel.textContent.includes('PRIVATE_RAW_ATTACHMENT_TITLE')
                );
                assert(
                    !panel.textContent.includes('Configured attachment title')
                );
                for (const node of [panel, ...panel.querySelectorAll('*')])
                    for (const attribute of node.attributes) {
                        assert(
                            !attribute.value.includes(
                                'PRIVATE_RAW_ATTACHMENT_TITLE'
                            )
                        );
                        assert(
                            !attribute.value.includes(
                                'Configured attachment title'
                            )
                        );
                    }
                if (scenario === 'custom-title-clear')
                    assert.equal(
                        file.parentElement.querySelector('label').textContent,
                        'Configured attachment title'
                    );
                if (scenario === 'hidden-clear') {
                    const toggle = field('fld_review_show');
                    toggle.checked = false;
                    toggle.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    assert.equal(file.parentElement.hidden, true);
                }
                submit();
                await settled();
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(calls.length, 1);
                assert(
                    document
                        .getElementById('status')
                        .textContent.includes('Upload or clear')
                );
                assert.equal(
                    button('Clear pending files').closest('[hidden]'),
                    null
                );
                clear();
                assert.equal(clearControl.hidden, true);
                assert.equal(file.files.length, 0);
                button('Edit', await open()).click();
                assert.equal(saves().length, 0);
            } else if (scenario === 'dispose-observer') {
                const accepted = probe.attachmentPageForTest();
                const oldInput = file;
                setFile();
                const oldClear = button('Clear pending files');
                button('Disconnect').click();
                await settled();
                for (const key of [
                    'extensionAccessToken',
                    'persistedAddOnlyAttachmentValuesByFieldId',
                ])
                    Object.defineProperty(accepted.payload, key, {
                        configurable: true,
                        get() {
                            assert.fail(
                                'disposed attachment configuration was read'
                            );
                        },
                    });
                probe.observeAttachmentConfigurationForTest();
                oldInput.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                oldClear.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                assert.equal(oldInput.files.length, 1);
                assert.equal(calls.length, 1);
                assert.equal(saves().length, 0);
            } else if (scenario.startsWith('upload')) {
                const first = setFile();
                const upload = [
                    ...file.parentElement.querySelectorAll('button'),
                ].find((node) => node.textContent === 'Upload selected file');
                assert(upload);
                upload.click();
                upload.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                await waitFor(() => calls.some((call) => call.route === 'PUT'));
                submit();
                await settled();
                assert.equal(document.querySelector('dialog'), null);
                if (scenario === 'upload-replacement')
                    setFile('replacement.txt');
                if (scenario === 'upload-cancel')
                    document.getElementById('cancel').click();
                if (scenario === 'upload-stale') {
                    document.getElementById('visitor').value = 'B';
                    document
                        .getElementById('visitor')
                        .dispatchEvent(
                            new window.Event('change', { bubbles: true })
                        );
                }
                releaseUpload();
                await waitFor(
                    () =>
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assert.equal(
                    calls.filter(
                        (call) => call.route === 'createPublicUploadLink'
                    ).length,
                    1
                );
                assert.equal(
                    calls.filter((call) => call.route === 'PUT').length,
                    1
                );
                assert.equal(saves().length, 0);
                if (scenario === 'upload') {
                    assert.equal(file.files.length, 0);
                    const dialog = await open();
                    assert(dialog.textContent.includes('new-file.txt'));
                    button('Confirm', dialog).click();
                    await waitFor(() => saves().length === 1);
                    expected.fld_review_files.push({
                        id: null,
                        url: 'https://files.invalid/PRIVATE_UPLOADED',
                        filename: first.name,
                        size: first.size,
                        type: first.type,
                    });
                    assert.deepEqual(
                        saves()[0].input.formRecord.data,
                        expected
                    );
                    assert.deepEqual(
                        saves()[0].input.formFieldIdsWithUnsavedChanges,
                        ['fld_review_files']
                    );
                } else if (scenario === 'upload-replacement') {
                    assert.equal(file.files[0].name, 'replacement.txt');
                    submit();
                    await settled();
                    assert.equal(document.querySelector('dialog'), null);
                    clear();
                    const review = await open();
                    assert(review.textContent.includes('new-file.txt'));
                    assert(!review.textContent.includes('replacement.txt'));
                    button('Edit', review).click();
                } else {
                    assert.equal(file.files[0], first);
                    const before = calls.length;
                    file.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    submit();
                    await settled();
                    assert.equal(calls.length, before);
                    assert.equal(saves().length, 0);
                }
            } else {
                const dialog = await open();
                const held = button('Confirm', dialog);
                if (scenario === 'pending-aba') {
                    setFile();
                    clear();
                }
                if (scenario === 'draft-aba') {
                    edit('fld_review_title', 'Temporary');
                    edit('fld_review_title', initial.fld_review_title);
                }
                if (scenario === 'baseline-aba' || scenario === 'config-aba') {
                    const accepted = probe.attachmentPageForTest();
                    const object =
                        scenario === 'baseline-aba'
                            ? accepted.payload
                            : accepted.payload.fieldIdsToSchemas
                                  .fld_review_files.miniExtConfig;
                    const key =
                        scenario === 'baseline-aba'
                            ? 'persistedAddOnlyAttachmentValuesByFieldId'
                            : 'hideAttachmentName';
                    const old = object[key];
                    object[key] = scenario === 'baseline-aba' ? {} : true;
                    probe.observeAttachmentConfigurationForTest();
                    object[key] = old;
                    probe.observeAttachmentConfigurationForTest();
                }
                if (scenario === 'owner-aba') {
                    const visitor = document.getElementById('visitor');
                    visitor.value = 'B';
                    visitor.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    visitor.value = 'A';
                    visitor.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                }
                held.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                await settled();
                assert.equal(saves().length, 0);
                if (scenario !== 'owner-aba') {
                    button('Confirm', await open()).click();
                    await waitFor(() => saves().length === 1);
                    assert.deepEqual(
                        saves()[0].input.formRecord.data,
                        expected
                    );
                }
            }
            await settled();
            console.log(`Packed attachment Review: ${scenario} passed`);
        } finally {
            releaseUpload();
            await settled();
            for (const [key, descriptor] of previous)
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            await window.happyDOM.close();
        }
    }
    return { checks: matrixChecks, browserChecks: scenarios.length };
}
