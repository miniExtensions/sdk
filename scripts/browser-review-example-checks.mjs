import { addDateReviewAnswers } from './review-date-recipe-checks.mjs';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { addSelectReviewAnswers } from './form-review-recipe-checks.mjs';
import { addAttachmentReviewAnswers } from './attachment-review-recipe-checks.mjs';
import { addLinkedReviewAnswers } from './linked-review-recipe-checks.mjs';
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
    for (const name of ['main.ts', 'review.ts', 'linkedReview.ts'])
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
            path.endsWith('dist/esm/ui/selectPolicy.js')
        )
    );
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('src/review.ts')
        )
    );
    const scenarios = [
        'answers',
        'date-client-zone',
        'date-locale',
        'date-writable',
        'date-fixed-zone',
        'date-only-zone',
        'date-empty-client',
        'date-hidden-client',
        'refused-date-naive',
        'refused-date-apia',
        'linked-options',
        'linked-rich-url',
        'linked-create-missing',
        'linked-create-null',
        'linked-create-empty-string',
        'linked-create-blank',
        'linked-create-empty-array',
        'linked-stale-options',
        'linked-presentation-aba',
        'linked-detail-config',
        'confirmed-draft-revision',
        'confirmed-owner-aba',
        'confirmed-reload',
        'confirmed-select-revision',
        'confirmed-logout',
        'confirmed-label-config',
        'confirmed-condition-config',
        'writable-ineligible-selection',
        'empty-multi-selection',
        'validation',
        'unknown-transport',
        'cancelled-held',
        'unsupported-section',
        'refused-single-object',
        'refused-single-array',
        'refused-scalar-array',
        'refused-duplicate-choice-id',
        'refused-duplicate-choice-name',
        'refused-malformed-choice',
        'refused-multi-null',
        'refused-multi-empty-name',
        'refused-linked-malformed',
        'refused-attachment-malformed',
        'refused-select-driver',
        'refused-select-hide-empty',
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
        const selectRows = addSelectReviewAnswers(form);
        const dateRows = addDateReviewAnswers(form);
        const previousTZ = process.env.TZ;
        process.env.TZ =
            scenario === 'refused-date-apia' ? 'Pacific/Apia' : 'UTC';
        if (scenario === 'date-locale') {
            form.payload.publicFields.state.language = 'fr';
            form.payload.fieldIdsToSchemas.fld_review_date.airtableField.config.options.dateFormat =
                { name: 'friendly', format: 'LL' };
        }
        if (scenario === 'date-writable')
            form.payload.fieldIdsToSchemas.fld_review_date.miniExtConfig.readOnly = false;
        if (scenario === 'refused-date-apia')
            form.payload.formRecord.data.fld_review_date = '2011-12-30';
        if (scenario === 'refused-date-naive')
            form.payload.formRecord.data.fld_review_datetime =
                '2026-03-08T10:30:00';
        if (
            [
                'date-client-zone',
                'date-empty-client',
                'date-hidden-client',
            ].includes(scenario)
        )
            form.payload.fieldIdsToSchemas.fld_review_datetime.airtableField.config.options.timeZone =
                'client';
        if (scenario === 'date-empty-client')
            form.payload.formRecord.data.fld_review_datetime = null;
        if (scenario === 'date-only-zone')
            form.payload.formRecord.data.fld_review_datetime = null;
        if (scenario === 'date-hidden-client') {
            form.payload.fieldIdsToSchemas.fld_review_datetime.miniExtConfig.conditionalFields =
                structuredClone(
                    form.payload.fieldIdsToSchemas.fld_review_conditional
                        .miniExtConfig.conditionalFields
                );
            form.payload.formRecord.data.fld_review_show = false;
            form.payload.formRecord.data.fld_review_datetime =
                'PRIVATE_INVALID_HIDDEN_DATE';
        }
        const linkedFixture = addLinkedReviewAnswers(form);
        if (
            [
                'linked-options',
                'linked-stale-options',
                'linked-rich-url',
            ].includes(scenario)
        )
            for (const id of linkedFixture.ids)
                form.payload.fieldIdsToSchemas[id].miniExtConfig.readOnly =
                    false;
        const richURL = 'https://synthetic-sdk.invalid/PRIVATE_RICH_URL';
        if (scenario === 'linked-rich-url') {
            form.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].miniExtConfig.displayAsAttachments = true;
            linkedFixture.records[0].fields.fld_link_title = richURL;
        }
        if (scenario.startsWith('linked-create-')) {
            const empty = {
                'linked-create-null': null,
                'linked-create-empty-string': '',
                'linked-create-blank': ' \t ',
                'linked-create-empty-array': [],
            };
            form.payload.formRecord = {
                type: 'create',
                data:
                    scenario === 'linked-create-missing'
                        ? {}
                        : { fld_review_link: empty[scenario] },
            };
            for (const id of linkedFixture.ids)
                form.payload.fieldIdsToSchemas[id].miniExtConfig.required =
                    false;
        }
        if (scenario === 'empty-multi-selection')
            form.payload.formRecord.data.fld_review_multi = [];
        if (scenario === 'refused-duplicate-choice-id')
            form.payload.fieldIdsToSchemas.fld_review_single.airtableField.config.options.choices =
                [
                    { id: 'duplicate', name: 'PrivateFirst' },
                    { id: 'duplicate', name: 'PrivateSecond' },
                ];
        if (scenario === 'refused-duplicate-choice-name')
            form.payload.fieldIdsToSchemas.fld_review_single.airtableField.config.options.choices =
                [
                    { id: 'one', name: 'PrivateDuplicate' },
                    { id: 'two', name: 'PrivateDuplicate' },
                ];
        if (scenario === 'refused-malformed-choice')
            form.payload.fieldIdsToSchemas.fld_review_single.airtableField.config.options.choices =
                [null];
        if (scenario === 'writable-ineligible-selection') {
            form.payload.fieldIdsToSchemas.fld_review_single.miniExtConfig.readOnly = false;
            form.payload.formRecord.data.fld_review_single = 'Second';
        }
        if (scenario === 'refused-single-array')
            form.payload.formRecord.data.fld_review_single = [];
        if (scenario === 'refused-scalar-array')
            form.payload.formRecord.data.fld_review_readonly = [];
        if (scenario === 'refused-single-object')
            form.payload.formRecord.data.fld_review_single = {
                private: 'PrivateMalformedSelect',
            };
        if (scenario === 'refused-multi-null')
            form.payload.formRecord.data.fld_review_multi = ['First', null];
        if (scenario === 'refused-multi-empty-name')
            form.payload.formRecord.data.fld_review_multi = [''];
        if (scenario === 'refused-select-hide-empty')
            form.payload.fieldIdsToSchemas.fld_review_single.miniExtConfig.hideFieldIfEmpty = true;
        if (scenario === 'refused-select-driver') {
            const setting =
                form.payload.fieldIdsToSchemas.fld_review_conditional
                    .miniExtConfig.conditionalFields.conditions[0].setting;
            setting.idOrName.id = 'fld_review_single';
            setting.fieldType = 'singleSelect';
            setting.value = 'First';
        }
        if (
            [
                'refused-linked-malformed',
                'refused-attachment-malformed',
            ].includes(scenario)
        ) {
            const type =
                scenario === 'refused-linked-malformed'
                    ? 'multipleRecordLinks'
                    : 'multipleAttachments';
            const schema = form.payload.fieldIdsToSchemas.fld_review_multi;
            schema.fieldType = type;
            schema.airtableField.config =
                type === 'multipleRecordLinks'
                    ? {
                          type,
                          options: {
                              linkedTableId: 'tbl_review_child',
                              inverseLinkFieldId: 'fld_review_parent',
                              isReversed: false,
                              prefersSingleRecordLink: false,
                          },
                      }
                    : { type };
            form.payload.formRecord.data.fld_review_multi = [null];
        }
        if (scenario === 'confirmed-select-revision') {
            form.payload.fieldIdsToSchemas.fld_review_single.miniExtConfig = {};
        }
        if (scenario === 'unsupported-section') {
            form.payload.fieldIdsToSchemas.fld_review_readonly.miniExtConfig.headerSectionTitle =
                'Retained section';
            form.payload.fieldIdsToSchemas.fld_review_readonly.miniExtConfig.enableSectionHeader = false;
            form.payload.fieldIdsToSchemas.fld_review_readonly.miniExtConfig.hideFieldIfEmpty = true;
        }
        if (
            [
                'validation',
                'unknown-transport',
                'cancelled-held',
                'confirmed-owner-aba',
                'confirmed-reload',
                'confirmed-logout',
            ].includes(scenario)
        )
            addAttachmentReviewAnswers(form);
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
        const linkedCalls = [];
        let releaseLinked;
        const heldLinked = new Promise((resolve) => {
            releaseLinked = resolve;
        });
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            if (
                url.searchParams.get('route') ===
                'fetchRecordsForFormLinkedRecordsSelector'
            ) {
                linkedCalls.push(JSON.parse(init.body));
                if (scenario === 'linked-stale-options') await heldLinked;
                return new Response(JSON.stringify(linkedFixture.options));
            }
            if (
                scenario.startsWith('linked-create-') &&
                url.searchParams.get('route') === 'saveForm'
            ) {
                assert.equal(init.method, 'POST');
                assert.equal(init.credentials, 'omit');
                assert.equal(url.origin, 'https://synthetic-sdk.invalid');
                const native = JSON.parse(init.body);
                assert.equal(
                    native.extensionAccessToken,
                    form.payload.extensionAccessToken
                );
                assert.deepEqual(native.formRecord, {
                    type: 'create',
                    data: initial,
                });
                assert(!Object.hasOwn(native.formRecord, 'tableId'));
                assert(!Object.hasOwn(native.formRecord, 'recordId'));
                delete native.miniExtStorageV4;
                delete native.miniExtSession;
                fixture.state.calls.push({
                    route: 'saveForm',
                    method: init.method,
                    input: structuredClone(native),
                    credentialsMode: init.credentials,
                });
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    }),
                    { headers: { 'Content-Type': 'application/json' } }
                );
            }
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
            let sourceProbe;
            if (
                scenario.endsWith('-config') ||
                scenario === 'linked-presentation-aba'
            ) {
                // Test-only observer; normal starter execution stays unchanged
                // for every other case. No production test hook is shipped.
                const probeFile = join(
                    consumer,
                    '.generated',
                    `review-${scenario}.mjs`
                );
                const probe = await build({
                    absWorkingDir: consumer,
                    entryPoints: [join(consumer, 'src/main.ts')],
                    bundle: true,
                    platform: 'browser',
                    format: 'esm',
                    outfile: probeFile,
                    metafile: true,
                    plugins: [
                        {
                            name: 'accepted-page-observer',
                            setup(build) {
                                build.onLoad(
                                    { filter: /\/src\/main\.ts$/ },
                                    (args) => ({
                                        loader: 'ts',
                                        contents:
                                            readFileSync(args.path, 'utf8')
                                                .replace(
                                                    '    const linkedPresentation = createLinkedReviewPresentation(',
                                                    '    const linkedPresentation = createLinkedReviewPresentation('
                                                )
                                                .replace(
                                                    '    const readFilterMetadata = (context:',
                                                    '    linkedReviewForTest = linkedPresentation;\n    const readFilterMetadata = (context:'
                                                ) +
                                            '\nlet linkedReviewForTest: ReturnType<typeof createLinkedReviewPresentation>;\nexport const linkedPresentationForTest = () => linkedReviewForTest;\nexport const acceptedReviewPageForTest = () => visitors[activeVisitor].screen;\n',
                                    })
                                );
                            },
                        },
                    ],
                });
                await assertBrowserInputs(probe.metafile, consumer);
                sourceProbe = await import(pathToFileURL(probeFile).href);
            } else
                await import(
                    `${pathToFileURL(outfile).href}?review=${revision}`
                );
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
            await waitFor(
                () =>
                    field('fld_review_title') !== null ||
                    (scenario.startsWith('refused-') &&
                        document
                            .getElementById('status')
                            .classList.contains('error'))
            );
            assert.equal(saves().length, 0);
            if (
                scenario === 'unsupported-section' ||
                scenario.startsWith('refused-')
            ) {
                // Some malformed native shapes are rejected by existing load
                // controls before Review can mount; retain that earlier refusal.
                if (field('fld_review_title')) submit();
                await settled();
                assert.equal(document.querySelector('dialog'), null);
                assert(
                    document
                        .getElementById('status')
                        .classList.contains('error')
                );
                assert(
                    !document
                        .getElementById('status')
                        .textContent.includes('Private')
                );
                assert.equal(saves().length, 0);
            } else if (scenario.startsWith('date-')) {
                const expectedData = structuredClone(initial);
                if (scenario === 'date-writable') {
                    edit('fld_review_date', '2024-03-01');
                    expectedData.fld_review_date = '2024-03-01';
                }
                let dialog = await open();
                const dateRow = dialog.querySelector(
                    '[data-review-field-id="fld_review_date"]'
                );
                assert.equal(
                    dateRow.nextElementSibling.textContent,
                    scenario === 'date-locale'
                        ? 'February 29, 2024'
                        : scenario === 'date-writable'
                          ? '2024-03-01'
                          : '2024-02-29'
                );
                if (
                    [
                        'date-only-zone',
                        'date-empty-client',
                        'date-hidden-client',
                    ].includes(scenario)
                )
                    assert.equal(
                        dialog.querySelector(
                            '[data-review-field-id="fld_review_datetime"]'
                        ),
                        null
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
                process.env.TZ = 'America/Los_Angeles';
                button(dialog, 'Confirm').click();
                await settled();
                if (scenario === 'date-client-zone') {
                    assert.equal(saves().length, 0);
                    dialog = await open();
                    assert.equal(
                        dialog.querySelector(
                            '[data-review-field-id="fld_review_datetime"]'
                        ).nextElementSibling.textContent,
                        '2026-03-08 03:30'
                    );
                    button(dialog, 'Confirm').click();
                }
                await waitFor(() => saves().length === 1);
                assert.deepEqual(
                    saves()[0].input.formRecord.data,
                    expectedData
                );
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    scenario === 'date-writable' ? ['fld_review_date'] : []
                );
                assert.equal(linkedCalls.length, 0);
            } else if (scenario.startsWith('linked-create-')) {
                let dialog = await open();
                for (const id of linkedFixture.ids)
                    assert.equal(
                        dialog.querySelector(`[data-review-field-id="${id}"]`),
                        null
                    );
                assert.equal(linkedCalls.length, 0);
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
                button(dialog, 'Confirm').click();
                await waitFor(() => saves().length === 1);
                assert.deepEqual(saves()[0].input.formRecord, {
                    type: 'create',
                    data: initial,
                });
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    []
                );
                assert.equal(linkedCalls.length, 0);
            } else if (scenario.startsWith('linked-')) {
                const generic = 'Selected record — details unavailable';
                const labels = (dialog) =>
                    linkedFixture.ids.map(
                        (id) =>
                            dialog.querySelector(
                                `[data-review-field-id="${id}"]`
                            ).nextElementSibling.textContent
                    );
                if (
                    scenario === 'linked-options' ||
                    scenario === 'linked-stale-options' ||
                    scenario === 'linked-rich-url'
                ) {
                    const searchButtons = [
                        ...document.querySelectorAll('button'),
                    ].filter((node) => node.textContent === 'Search choices');
                    assert.equal(searchButtons.length, 3);
                    searchButtons[0].click();
                    if (scenario === 'linked-stale-options') {
                        await waitFor(() => linkedCalls.length === 1);
                        const input = document.querySelector(
                            'input[placeholder="Search available linked records"]'
                        );
                        input.value = 'new search';
                        input.dispatchEvent(
                            new window.Event('input', { bubbles: true })
                        );
                        releaseLinked();
                    }
                    await waitFor(
                        () =>
                            linkedCalls.length === 1 &&
                            document
                                .getElementById('screen')
                                .getAttribute('aria-busy') === 'false'
                    );
                    assert.equal(
                        linkedCalls[0].linkedRecordFieldId,
                        'fld_review_link'
                    );
                    if (scenario === 'linked-options') {
                        for (const index of [1, 2]) {
                            searchButtons[index].click();
                            await waitFor(
                                () =>
                                    linkedCalls.length === index + 1 &&
                                    document
                                        .getElementById('screen')
                                        .getAttribute('aria-busy') === 'false'
                            );
                            assert.equal(
                                linkedCalls[index].linkedRecordFieldId,
                                linkedFixture.ids[index]
                            );
                        }
                    }
                }
                const expectedData = structuredClone(initial);
                if (scenario === 'linked-options') {
                    const searchButton = [
                        ...document.querySelectorAll('button'),
                    ].find((node) => node.textContent === 'Search choices');
                    const choiceInputs = [
                        ...searchButton.parentElement.querySelectorAll(
                            '.choice-list input[type="checkbox"]'
                        ),
                    ];
                    assert.equal(choiceInputs.length, 2);
                    assert.equal(choiceInputs[1].checked, false);
                    choiceInputs[1].checked = true;
                    choiceInputs[1].dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    expectedData.fld_review_link = [
                        'rec_original',
                        'rec_missing',
                        'rec_new',
                    ];
                    assert.deepEqual(
                        JSON.parse(field('fld_review_link').value),
                        expectedData.fld_review_link
                    );
                }
                let dialog = await open();
                const expected =
                    scenario === 'linked-options'
                        ? [
                              '<b>Authorized name</b>',
                              generic,
                              '<b>Authorized name</b>',
                          ].join('\n')
                        : Array(3).fill(generic).join('\n');
                assert.deepEqual(labels(dialog), [
                    expected,
                    scenario === 'linked-options'
                        ? ['••••••••', generic, '••••••••'].join('\n')
                        : Array(3).fill(generic).join('\n'),
                    Array(3).fill(generic).join('\n'),
                ]);
                if (scenario === 'linked-rich-url') {
                    assert(!dialog.textContent.includes(richURL));
                    for (const node of [
                        dialog,
                        ...dialog.querySelectorAll('*'),
                    ])
                        for (const attribute of node.attributes)
                            assert(
                                !attribute.value.includes(richURL),
                                'raw rich-display URL is absent from every Review attribute'
                            );
                    assert.equal(
                        dialog.querySelector(
                            '[data-review-field-id="fld_review_link"]'
                        ).nextElementSibling.textContent,
                        Array(3).fill(generic).join('\n')
                    );
                }
                assert(!dialog.textContent.includes('PRIVATE'));
                assert.equal(dialog.querySelectorAll('b,a,img').length, 0);
                assert.equal(
                    linkedCalls.length,
                    scenario === 'linked-options'
                        ? 3
                        : ['linked-stale-options', 'linked-rich-url'].includes(
                                scenario
                            )
                          ? 1
                          : 0,
                    'Review performs zero linked reads'
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
                if (scenario === 'linked-presentation-aba') {
                    const scope = sourceProbe.linkedPresentationForTest();
                    scope.acceptOptions(
                        'fld_review_link',
                        linkedFixture.options
                    );
                    scope.acceptOptions('fld_review_link', {
                        ...linkedFixture.options,
                        records: [],
                    });
                } else if (scenario === 'linked-detail-config') {
                    const page = sourceProbe.acceptedReviewPageForTest();
                    page.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].isHidden = true;
                    assert.equal(
                        sourceProbe
                            .linkedPresentationForTest()
                            .snapshot()
                            .current(),
                        false
                    );
                    page.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].isHidden = false;
                }
                button(dialog, 'Confirm').click();
                if (
                    [
                        'linked-presentation-aba',
                        'linked-detail-config',
                    ].includes(scenario)
                ) {
                    await settled();
                    assert.equal(saves().length, 0);
                    if (scenario === 'linked-detail-config') {
                        const old = field('fld_review_title');
                        button(document, 'Reload').click();
                        await waitFor(
                            () =>
                                field('fld_review_title') != null &&
                                field('fld_review_title') !== old
                        );
                    }
                    dialog = await open();
                    button(dialog, 'Confirm').click();
                }
                await waitFor(() => saves().length === 1);
                assert.deepEqual(saves()[0].input.formRecord, {
                    ...form.payload.formRecord,
                    data: expectedData,
                });
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    scenario === 'linked-options' ? ['fld_review_link'] : []
                );
                assert.deepEqual(saves()[0].input.context, {
                    type: 'direct-url',
                });
                assert.equal(
                    linkedCalls.length,
                    scenario === 'linked-options'
                        ? 3
                        : ['linked-stale-options', 'linked-rich-url'].includes(
                                scenario
                            )
                          ? 1
                          : 0
                );
            } else if (scenario === 'empty-multi-selection') {
                const dialog = await open();
                assert.equal(
                    dialog.querySelector(
                        '[data-review-field-id="fld_review_multi"]'
                    ),
                    null
                );
                button(dialog, 'Confirm').click();
                await waitFor(() => saves().length === 1);
                assert.deepEqual(saves()[0].input.formRecord.data, initial);
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    []
                );
            } else if (scenario === 'writable-ineligible-selection') {
                const select = field('fld_review_single');
                assert.equal(select.disabled, false);
                assert.equal(select.value, 'Second');
                const dialog = await open();
                const label = dialog.querySelector(
                    '[data-review-field-id="fld_review_single"]'
                );
                assert.equal(
                    label.nextElementSibling.textContent,
                    '<i>Label</i> (Second)'
                );
                button(dialog, 'Confirm').click();
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assert.deepEqual(saves()[0].input.formRecord.data, initial);
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    []
                );
                select.value = 'First';
                select.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                assert.equal(select.value, 'First');
                assert(
                    ![...select.options].some(
                        (option) => option.value === 'Second'
                    ),
                    'ineligible removed selection is not offered as a new choice'
                );
                const forbidden = document.createElement('option');
                forbidden.value = 'Second';
                forbidden.textContent = 'Crafted unavailable option';
                select.append(forbidden);
                select.value = 'Second';
                select.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                assert.equal(
                    select.value,
                    'First',
                    'actual installed handler rejects newly selecting the restricted name'
                );
                assert.equal(saves().length, 1);
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
                        'fld_review_single',
                        'fld_review_multi',
                        'Date answer',
                        'Date answer',
                        ...linkedFixture.ids,
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
                        ...selectRows,
                        ...dateRows,
                        ...linkedFixture.ids.map(() =>
                            Array(3)
                                .fill('Selected record — details unavailable')
                                .join('\n')
                        ),
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
                } else if (scenario === 'confirmed-select-revision') {
                    const select =
                        field('fld_review_single').querySelector('select') ??
                        field('fld_review_single');
                    for (const value of ['Second', 'First']) {
                        select.value = value;
                        select.dispatchEvent(
                            new window.Event('change', { bubbles: true })
                        );
                    }
                } else if (scenario === 'confirmed-logout') {
                    document.getElementById('logout').click();
                    await settled();
                    assert.equal(saves().length, 0);
                    button(document, 'Reload').click();
                } else if (
                    scenario.endsWith('-config') ||
                    scenario === 'linked-presentation-aba'
                ) {
                    const config =
                        sourceProbe.acceptedReviewPageForTest().payload
                            .fieldIdsToSchemas.fld_review_single.miniExtConfig;
                    if (scenario === 'confirmed-label-config')
                        config.conditionsForOptions[0].config.name =
                            'Updated label';
                    else config.enableConditionalOptions = false;
                } else button(document, 'Reload').click();
                await settled();
                await waitFor(() => field('fld_review_title') !== null);
                assert.equal(saves().length, 0);
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(
                    field('fld_review_title').value,
                    initial.fld_review_title
                );
                if (
                    ![
                        'confirmed-draft-revision',
                        'confirmed-select-revision',
                    ].includes(scenario) &&
                    !scenario.endsWith('-config')
                )
                    assert.notEqual(field('fld_review_title'), originalControl);
                const fresh = await open();
                if (
                    scenario.endsWith('-config') ||
                    scenario === 'linked-presentation-aba'
                ) {
                    const label = fresh.querySelector(
                        '[data-review-field-id="fld_review_single"]'
                    );
                    assert.equal(
                        label.nextElementSibling.textContent,
                        scenario === 'confirmed-label-config'
                            ? 'Updated label'
                            : 'First'
                    );
                }
                button(fresh, 'Confirm').click();
                await waitFor(() => saves().length === 1);
                assert.equal(
                    saves()[0].input.formRecord.data.fld_review_title,
                    initial.fld_review_title
                );
                assert.deepEqual(saves()[0].input.formRecord.data, initial);
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    scenario === 'confirmed-draft-revision'
                        ? ['fld_review_title']
                        : scenario === 'confirmed-select-revision'
                          ? ['fld_review_single']
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
                [
                    'confirmed-reload',
                    'confirmed-logout',
                    'linked-detail-config',
                ].includes(scenario)
                    ? 2
                    : 1
            );
            console.log(
                `[packed review ${revision + 1}/${scenarios.length}] ${scenario}: passed`
            );
        } catch (error) {
            throw new Error(`Packed review scenario failed: ${scenario}`, {
                cause: error,
            });
        } finally {
            if (previousTZ === undefined) delete process.env.TZ;
            else process.env.TZ = previousTZ;
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
