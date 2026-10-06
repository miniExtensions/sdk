import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';

const wait = async (predicate) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Installed section consumer did not reach its expected state');
};
const settle = async () => {
    for (let i = 0; i < 6; i++)
        await new Promise((resolve) => setImmediate(resolve));
};

/** Actual shipped typed custom recipe plus complete installed starter; closed synthetic transport. */
export async function checkSectionProjectionRecipe({
    consumerDirectory,
    guideSources,
    browserDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const matches = guideSources
        .map((name) => resolve(consumer, name))
        .filter((path) =>
            readFileSync(path, 'utf8').includes(
                'export function sectionProjection('
            )
        );
    assert.equal(matches.length, 1);
    const compiled = matches[0] + '.section-projection.mjs';
    writeFileSync(
        compiled,
        (
            await transform(readFileSync(matches[0], 'utf8'), {
                loader: 'ts',
                format: 'esm',
                target: 'es2022',
            })
        ).code
    );
    const { sectionProjection } = await import(pathToFileURL(compiled).href);
    const forms = await import(
        pathToFileURL(
            join(
                consumer,
                'node_modules/@miniextensions/sdk/dist/esm/forms/index.js'
            )
        ).href
    );
    const commonJs = createRequire(join(consumer, 'package.json'))(
        '@miniextensions/sdk/forms'
    );
    assert.equal(typeof commonJs.createScalarFormRecordProjection, 'function');
    const canonical = JSON.parse(
        readFileSync('test/fixtures/sectionProjection.json', 'utf8')
    );
    for (const fixture of canonical.cases) {
        const loaded = createReviewFixture('review-answers').page();
        loaded.payload.fieldIdsInForm = fixture.input.fieldIds;
        loaded.payload.fieldIdsToSchemas = fixture.input.fieldIdsToSchemas;
        loaded.payload.formRecord = {
            type: 'edit',
            recordId: fixture.input.recordId,
            tableId: 'tbl_synthetic',
            data: fixture.input.data,
        };
        const before = structuredClone(loaded);
        const result = sectionProjection(
            loaded,
            loaded.payload.formRecord.data
        );
        assert.equal(result.type, 'available');
        assert.deepEqual(result.record, fixture.expected.record);
        assert.deepEqual(
            result.hiddenFieldIds,
            fixture.expected.hiddenFieldIds
        );
        const cjs = commonJs.createScalarFormRecordProjection(fixture.input);
        assert.equal(cjs.type, 'available');
        assert.deepEqual(cjs.record, fixture.expected.record);
        assert.deepEqual(cjs.hiddenFieldIds, fixture.expected.hiddenFieldIds);
        assert.deepEqual(loaded, before);
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const entry = join(browserDirectory, '.generated/section-consumers.ts');
    writeFileSync(
        entry,
        "export { flatChoiceConditionRecord } from '../src/choiceAvailability.js';\nexport { prepareFormReviewRows } from '../src/review.js';\n"
    );
    const adapterFile = join(
        browserDirectory,
        '.generated/section-consumers.mjs'
    );
    const bundled = await build({
        absWorkingDir: browserDirectory,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: adapterFile,
        metafile: true,
        logLevel: 'silent',
    });
    await assertBrowserInputs(bundled.metafile, browserDirectory);
    const adapters = await import(pathToFileURL(adapterFile).href);
    const mainFile = join(browserDirectory, '.generated/section-main.mjs');
    const main = await build({
        absWorkingDir: browserDirectory,
        entryPoints: [join(browserDirectory, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: mainFile,
        metafile: true,
        logLevel: 'silent',
    });
    await assertBrowserInputs(main.metafile, browserDirectory);
    let cases = canonical.cases.length;
    for (const scenario of [
        'express-choice',
        'scalar-review',
        'disabled-header',
        'edit-empty-blocked',
    ]) {
        const page = createReviewFixture('review-answers').page();
        const schema = page.payload.fieldIdsToSchemas;
        const header = schema.fld_review_conditional;
        Object.assign(header.miniExtConfig, {
            headerSectionTitle: 'Delivery',
            enableSectionHeader: scenario !== 'disabled-header',
            applyFieldConditionsToSection: true,
        });
        Object.assign(schema.fld_review_number.miniExtConfig, {
            headerSectionTitle: 'Independent',
            applyFieldConditionsToSection: false,
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'never',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'checkbox',
                            idOrName: { type: 'id', id: 'fld_review_show' },
                            value: false,
                        },
                    },
                ],
            },
        });
        page.payload.fieldIdsInForm = [
            'fld_review_title',
            'fld_review_show',
            'fld_review_conditional',
            'fld_review_readonly',
            'fld_review_number',
            'fld_review_url',
        ];
        if (scenario === 'express-choice') {
            page.payload.publicFields.state.promptUserBeforeSubmission = false;
            const select = {
                fieldType: 'singleSelect',
                airtableField: {
                    id: 'fld_service',
                    name: 'Service',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: {
                        type: 'singleSelect',
                        options: {
                            choices: [
                                { id: 'sel_standard', name: 'Standard' },
                                { id: 'sel_express', name: 'Express' },
                            ],
                        },
                    },
                },
                miniExtConfig: {
                    enableConditionalOptions: true,
                    conditionsForOptions: [
                        {
                            id: 'express',
                            config: {
                                optionForConditions: 'sel_express',
                                conditionsForOption: {
                                    logicalOperator: 'and',
                                    conditions: [
                                        {
                                            id: 'rush',
                                            type: 'singleCondition',
                                            setting: {
                                                type: 'is',
                                                fieldType: 'singleLineText',
                                                idOrName: {
                                                    type: 'id',
                                                    id: 'fld_review_readonly',
                                                },
                                                value: 'Plain readonly answer',
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            };
            // Actual initial readonly value, rather than a display label, drives the rule.
            select.miniExtConfig.conditionsForOptions[0].config.conditionsForOption.conditions[0].setting.value =
                page.payload.formRecord.data.fld_review_readonly;
            schema.fld_service = select;
            page.payload.fieldIdsInForm.push('fld_service');
            page.payload.formRecord.data.fld_service = null;
        }
        if (scenario === 'edit-empty-blocked')
            schema.fld_review_readonly.miniExtConfig.hideFieldIfEmpty = true;
        page.payload.formFieldIdsWithUnsavedChanges = [];
        const initial = structuredClone(page.payload.formRecord.data);
        const beforePage = structuredClone(page);
        const calls = [];
        const window = new Window({
            url: 'https://section.example.test',
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        window.document.write(
            readFileSync(join(browserDirectory, 'index.html'), 'utf8').replace(
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
            Option: function (text = '', value = '') {
                const node = window.document.createElement('option');
                node.textContent = text;
                node.value = value;
                return node;
            },
            fetch: async (resource, init) => {
                const url = new URL(String(resource));
                assert.equal(url.origin, 'https://synthetic-sdk.invalid');
                assert.equal(init.credentials, 'omit');
                assert.equal(init.method, 'POST');
                const route = url.searchParams.get('route');
                assert(
                    ['fetchExtensionForEndUser', 'saveForm'].includes(route),
                    `Unexpected route ${route}`
                );
                const input = JSON.parse(init.body);
                calls.push({ route, input });
                return new Response(
                    JSON.stringify(
                        route === 'fetchExtensionForEndUser'
                            ? page
                            : {
                                  type: 'error',
                                  formValidationErrors: [],
                                  formErrors: {},
                              }
                    )
                );
            },
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            await import(`${pathToFileURL(mainFile).href}?section=${scenario}`);
            const doc = window.document;
            const field = (id) => doc.querySelector(`[data-field-id="${id}"]`);
            const inputEvent = (node) =>
                node.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            const button = (scope, text) => {
                const nodes = [...scope.querySelectorAll('button')].filter(
                    (b) => b.textContent.trim() === text
                );
                assert.equal(nodes.length, 1);
                return nodes[0];
            };
            const saves = () =>
                calls.filter((call) => call.route === 'saveForm');
            doc.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            doc.getElementById('share-id').value = 'privacy_share_synthetic';
            doc.getElementById('connection-form').dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
            await wait(() => field('fld_review_show') != null);
            const form = field('fld_review_show').closest('form');
            const submit = () =>
                form.dispatchEvent(
                    new window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
            const gate = field('fld_review_show');
            gate.checked = false;
            inputEvent(gate);
            assert.equal(saves().length, 0);
            assert.equal(calls.length, 1);
            const presentation = forms.composeFormFieldVisibility({
                fieldIds: page.payload.fieldIdsInForm,
                fieldIdsToSchemas: schema,
                airtableFields: Object.values(schema).map(
                    (s) => s.airtableField
                ),
                data: { ...initial, fld_review_show: false },
                formRecordType: 'edit',
                evaluationMode: 'runtime',
                invalidConditionMode: 'strict',
            });
            if (scenario === 'edit-empty-blocked') {
                assert.equal(presentation.fld_review_readonly.type, 'blocked');
                submit();
                await settle();
                assert.equal(doc.querySelector('dialog'), null);
                assert.equal(saves().length, 0);
                assert.match(
                    doc.getElementById('status').textContent,
                    /blocked|unavailable/i
                );
            } else {
                assert.equal(
                    presentation.fld_review_readonly.type,
                    scenario === 'disabled-header' ? 'visible' : 'hidden'
                );
                assert.equal(
                    field('fld_review_readonly').closest('[hidden]') !== null,
                    scenario !== 'disabled-header'
                );
                const full = { ...initial, fld_review_show: false };
                const projected = forms.createScalarFormRecordProjection({
                    fieldIds: page.payload.fieldIdsInForm,
                    fieldIdsToSchemas: schema,
                    airtableFields: Object.values(schema).map(
                        (s) => s.airtableField
                    ),
                    data: full,
                    recordId: page.payload.formRecord.recordId,
                    invalidConditionMode: 'strict',
                });
                assert.equal(projected.type, 'available');
                assert.equal(
                    Object.hasOwn(
                        projected.record.fields,
                        'fld_review_readonly'
                    ),
                    false
                );
                if (scenario === 'express-choice') {
                    assert.deepEqual(
                        adapters.flatChoiceConditionRecord(
                            page,
                            schema.fld_service,
                            full
                        ),
                        projected.record
                    );
                    const select = field('fld_service');
                    assert.deepEqual(
                        [...select.options].map((o) => o.value).filter(Boolean),
                        ['Standard']
                    );
                    gate.checked = true;
                    inputEvent(gate);
                    assert.equal(
                        field('fld_review_readonly').closest('[hidden]') !==
                            null,
                        false
                    );
                    assert.deepEqual(
                        [...select.options].map((o) => o.value).filter(Boolean),
                        ['Standard', 'Express']
                    );
                    select.value = 'Express';
                    select.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    gate.checked = false;
                    inputEvent(gate);
                    assert.equal(select.value, 'Express');
                    select.value = '';
                    select.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    assert.equal(select.value, '');
                } else {
                    const rows = adapters.prepareFormReviewRows(page, full);
                    assert.equal(
                        rows.some((r) => r.fieldId === 'fld_review_readonly'),
                        false
                    );
                    assert.equal(
                        rows.some((r) => r.value === '••••••••'),
                        true
                    );
                    submit();
                    await wait(() => doc.querySelector('dialog[open]') != null);
                    assert.equal(
                        doc
                            .querySelector('dialog')
                            .textContent.includes(initial.fld_review_readonly),
                        false
                    );
                    button(doc.querySelector('dialog'), 'Edit').click();
                    await settle();
                    gate.checked = true;
                    inputEvent(gate);
                    assert.equal(
                        field('fld_review_readonly').closest('[hidden]') !==
                            null,
                        false
                    );
                }
                const adjacent = field('fld_review_url');
                adjacent.value = 'https://example.test/accepted';
                inputEvent(adjacent);
                assert.equal(saves().length, 0);
                assert.equal(calls.length, 1);
                submit();
                if (scenario !== 'express-choice') {
                    await wait(() => doc.querySelector('dialog[open]') != null);
                    assert.equal(
                        doc
                            .querySelector('dialog')
                            .textContent.includes(initial.fld_review_readonly),
                        true
                    );
                    button(doc.querySelector('dialog'), 'Confirm').click();
                }
                await wait(
                    () =>
                        saves().length === 1 &&
                        doc
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                const saved = saves()[0].input;
                assert.deepEqual(saved.formRecord, {
                    ...page.payload.formRecord,
                    data: {
                        ...initial,
                        fld_review_show:
                            scenario === 'express-choice' ? false : true,
                        fld_review_url: 'https://example.test/accepted',
                    },
                });
                assert.deepEqual(
                    new Set(saved.formFieldIdsWithUnsavedChanges),
                    new Set(
                        scenario === 'express-choice'
                            ? [
                                  'fld_review_show',
                                  'fld_service',
                                  'fld_review_url',
                              ]
                            : ['fld_review_show', 'fld_review_url']
                    )
                );
                assert.equal(saved.context.type, 'direct-url');
                await settle();
                assert.equal(saves().length, 1);
            }
            assert.deepEqual(page, beforePage);
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
        cases++;
    }
    return {
        checks: cases,
        canonicalCases: canonical.cases.length,
        packedStarterCases: 4,
    };
}
