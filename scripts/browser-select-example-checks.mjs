import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { createProjectionFixture } from './build-privacy-browser-proof.mjs';

const waitFor = async (predicate) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Packed select example did not reach the expected state.');
};
const change = (window, node) =>
    node.dispatchEvent(new window.Event('change', { bubbles: true }));
const submit = (window, node) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const button = (document, title) => {
    const found = [...document.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === title
    );
    assert(found, `Missing actual starter button: ${title}`);
    return found;
};
const selected = (select) =>
    [...select.options]
        .filter((option) => option.selected)
        .map((option) => option.value);

const makeSelectForm = (scenario) => {
    const form = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    const type = scenario.single ? 'singleSelect' : 'multipleSelects';
    const schema = {
        fieldType: type,
        airtableField: {
            id: 'fld_colors',
            name: 'Colors',
            isComputed: scenario.computed === true,
            config: {
                type,
                options: {
                    choices: [
                        { id: 'sel_red', name: 'Red' },
                        { id: 'sel_blue', name: 'Blue' },
                    ],
                },
            },
        },
        miniExtConfig: {
            allowAddingNewOptions: true,
            ...scenario.config,
        },
    };
    form.payload.hasParentExtension = false;
    form.payload.fieldIdsInForm = ['fld_colors'];
    form.payload.fieldIdsToSchemas = { fld_colors: schema };
    form.payload.fieldNamesToSchemas = { Colors: schema };
    form.payload.formRecord = {
        type: 'create',
        data: {
            fld_colors: scenario.single ? 'Red' : ['Legacy', 'Red'],
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};

/** Synthetic dispatch tests of actual copied starter and installed exact SDK. */
export async function checkBrowserSelectExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(consumer, '.generated', 'select-main-checks.mjs');
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
    const scenarios = [
        {
            name: 'nonempty ID allowlist',
            restricted: true,
            config: {
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
                enableConditionalOptions: true,
                conditionsForOptions: [
                    {
                        id: 'display_blue',
                        config: {
                            optionForConditions: 'sel_blue',
                            name: ' Azure ',
                            conditionsForOption: {
                                logicalOperator: 'and',
                                conditions: [],
                            },
                        },
                    },
                ],
            },
        },
        {
            name: 'choice names are not allowlist IDs',
            restricted: true,
            noAllowedChoices: true,
            config: {
                singleOrMultiSelectLimitSelectionOptions: ['Blue'],
            },
        },
        {
            name: 'maximum permits removal before Add Choice',
            maximum: true,
            config: {
                singleOrMultiSelectLimitSelectionOptions: [],
                maxNumberOfSelections: 2,
            },
        },
        {
            name: 'empty allowlist permits Add Choice',
            adding: true,
            config: { singleOrMultiSelectLimitSelectionOptions: [] },
        },
        {
            name: 'read-only blocks choice creation and writes',
            locked: true,
            config: { readOnly: true },
        },
        {
            name: 'computed blocks choice creation and writes',
            locked: true,
            computed: true,
            config: {},
        },
        {
            name: 'single select emits native name',
            single: true,
            restricted: true,
            config: { singleOrMultiSelectLimitSelectionOptions: ['sel_blue'] },
        },
    ];
    let revision = 0;
    for (const scenario of scenarios) {
        const window = new Window({
            url: 'https://example.test',
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
        const form = makeSelectForm(scenario);
        const saves = [];
        const choiceInputs = [];
        const unexpected = [];
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.searchParams.get('route') === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(form));
            if (url.searchParams.get('route') === 'saveForm') {
                saves.push(JSON.parse(String(init?.body)));
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    })
                );
            }
            if (
                url.pathname ===
                '/api/trpc/airtable.addNewAirtableOptionForFormField'
            ) {
                choiceInputs.push(JSON.parse(String(init?.body)));
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                newChoice: {
                                    id: 'sel_green',
                                    name: 'Green',
                                    color: 'greenLight2',
                                },
                            },
                        },
                    })
                );
            }
            unexpected.push(url.pathname);
            throw new Error(
                'Packed select fixture attempted an unexpected call.'
            );
        };
        function Option(text = '', value = '') {
            const option = window.document.createElement('option');
            option.textContent = text;
            option.value = value;
            return option;
        }
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            Option,
            fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            await import(`${pathToFileURL(outfile).href}?case=${++revision}`);
            window.document.getElementById('api-origin').value =
                'https://sdk.example.test';
            window.document.getElementById('share-id').value = 'share_example';
            submit(window, window.document.getElementById('connection-form'));
            const selectFor = () =>
                window.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                );
            await waitFor(() => selectFor() !== null);
            const select = selectFor();
            const choice = window.document.querySelector(
                'input[placeholder="New choice name"]'
            );
            const originalCreate =
                choice === null
                    ? null
                    : button(window.document, 'Create choice');
            if (scenario.restricted || scenario.locked) {
                assert.equal(choice, null, scenario.name);
                assert.equal(
                    [...window.document.querySelectorAll('button')].some(
                        (node) => node.textContent?.trim() === 'Create choice'
                    ),
                    false,
                    scenario.name
                );
            }
            if (scenario.locked) {
                assert.equal(select.disabled, true);
                for (const option of select.options)
                    option.selected = option.value === 'Blue';
                change(window, select);
                assert.deepEqual(
                    new Set(selected(select)),
                    new Set(['Legacy', 'Red'])
                );
            } else if (scenario.noAllowedChoices) {
                assert.equal(
                    [...select.options].some(
                        (option) => option.value === 'Blue'
                    ),
                    false
                );
                for (const option of select.options) option.selected = false;
                change(window, select);
            } else if (scenario.maximum || scenario.adding) {
                assert(choice);
                choice.value = 'Green';
                button(window.document, 'Create choice').click();
                if (scenario.maximum) {
                    await new Promise((resolve) => setImmediate(resolve));
                    assert.equal(choiceInputs.length, 0);
                    const legacy = [...select.options].find(
                        (option) => option.value === 'Legacy'
                    );
                    legacy.selected = false;
                    change(window, select);
                    button(window.document, 'Create choice').click();
                }
                await waitFor(
                    () =>
                        choiceInputs.length === 1 &&
                        selected(selectFor()).includes('Green')
                );
            } else {
                const blue = [...select.options].find(
                    (option) => option.value === 'Blue'
                );
                assert(blue);
                if (!scenario.single) assert.equal(blue.textContent, 'Azure');
                if (scenario.single) select.value = 'Blue';
                else blue.selected = true;
                change(window, select);
                change(window, select);
            }
            submit(window, selectFor().closest('form'));
            await waitFor(
                () =>
                    saves.length === 1 &&
                    window.document
                        .getElementById('screen')
                        .getAttribute('aria-busy') === 'false'
            );
            const expected = scenario.single
                ? 'Blue'
                : scenario.locked
                  ? ['Legacy', 'Red']
                  : scenario.noAllowedChoices
                    ? []
                    : scenario.maximum
                      ? ['Red', 'Green']
                      : scenario.adding
                        ? ['Legacy', 'Red', 'Green']
                        : ['Legacy', 'Red', 'Blue'];
            assert.deepEqual(
                saves[0].formRecord.data.fld_colors,
                expected,
                scenario.name
            );
            assert.equal(
                saves[0].formFieldIdsWithUnsavedChanges.filter(
                    (id) => id === 'fld_colors'
                ).length,
                scenario.locked ? 0 : 1,
                scenario.name
            );
            assert.equal(
                choiceInputs.length,
                scenario.maximum || scenario.adding ? 1 : 0
            );
            assert.deepEqual(unexpected, []);
            button(window.document, "Clear this visitor's session").click();
            change(window, select);
            if (originalCreate !== null) {
                choice.value = 'Stale choice';
                originalCreate.click();
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(
                    choiceInputs.length,
                    scenario.maximum || scenario.adding ? 1 : 0
                );
            }
            button(window.document, 'Reload').click();
            await waitFor(() => selectFor() !== null);
            assert.notEqual(selectFor(), select);
            const baseline = scenario.single ? ['Red'] : ['Legacy', 'Red'];
            assert.deepEqual(new Set(selected(selectFor())), new Set(baseline));
            assert.equal(saves.length, 1);
            console.log(
                `[packed select ${revision}/${scenarios.length}] ${scenario.name}: passed`
            );
        } catch (error) {
            throw new Error(`Packed select scenario failed: ${scenario.name}`, {
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
    const portalChecks = await checkPackedPortalSelects({
        consumer,
        Window,
        outfile,
    });
    const projectionChecks = await checkPackedConditionalProjection({
        consumer,
        Window,
        outfile,
    });
    return { checks: scenarios.length + portalChecks + projectionChecks };
}

const checkPackedConditionalProjection = async ({
    consumer,
    Window,
    outfile,
}) => {
    const scenarios = [
        { name: 'single scalar conditional projection', multiple: false },
        { name: 'multiple scalar conditional projection', multiple: true },
        {
            name: 'retained disabled section title blocks projection',
            blocked: 'section',
        },
        { name: 'computed driver blocks projection', blocked: 'computed' },
    ];
    for (const [revision, scenario] of scenarios.entries()) {
        const window = new Window({
            url: 'https://projection.example.test',
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
        const fixture = createProjectionFixture(
            scenario.multiple ? 'projection-multiple' : 'projection-single'
        );
        const form = fixture.page();
        const driverSchema =
            form.payload.fieldIdsToSchemas.fld_projection_driver;
        if (scenario.blocked === 'section') {
            driverSchema.miniExtConfig.headerSectionTitle =
                'Retained section title';
            driverSchema.miniExtConfig.enableSectionHeader = false;
        } else if (scenario.blocked === 'computed') {
            driverSchema.airtableField.isComputed = true;
        }
        if (scenario.blocked)
            form.payload.formRecord.data.fld_projection_show = false;
        const initial = structuredClone(form.payload.formRecord.data);
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            const response = await fixture.fetch(input, init);
            return url.searchParams.get('route') === 'fetchExtensionForEndUser'
                ? new Response(JSON.stringify(form))
                : response;
        };
        function Option(text = '', value = '') {
            const option = window.document.createElement('option');
            option.textContent = text;
            option.value = value;
            return option;
        }
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            Option,
            fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            await import(
                `${pathToFileURL(outfile).href}?projection=${revision}`
            );
            window.document.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            window.document.getElementById('share-id').value =
                'privacy_share_synthetic';
            submit(window, window.document.getElementById('connection-form'));
            const choiceId = fixture.state.expected.choiceFieldId;
            const selectFor = () =>
                window.document.querySelector(
                    `select[data-field-id="${choiceId}"]`
                );
            await waitFor(() => selectFor() !== null);
            const select = selectFor();
            const show = window.document.querySelector(
                'input[data-field-id="fld_projection_show"]'
            );
            const driver = window.document.querySelector(
                'input[data-field-id="fld_projection_driver"]'
            );
            const witness = window.document.querySelector(
                'input[data-field-id="fld_projection_witness"]'
            );
            assert(show && driver && witness);
            const saves = () =>
                fixture.state.calls.filter((call) => call.route === 'saveForm');
            const availability = () =>
                window.document
                    .querySelector(
                        `[data-choice-availability-field-id="${choiceId}"]`
                    )
                    .getAttribute('data-choice-availability');
            const beta = () =>
                [...selectFor().options].find(
                    (option) => option.value === 'Beta'
                );
            const denied = () => assert(!beta() || beta().disabled);
            const displayed = (control) => control.closest('[hidden]') === null;
            assert.equal(saves().length, 0);
            denied();
            if (scenario.blocked) {
                assert.equal(availability(), 'blocked');
                const injected = window.document.createElement('option');
                injected.value = 'Beta';
                injected.selected = true;
                select.append(injected);
                change(window, select);
                assert.deepEqual(selected(select).filter(Boolean), []);
                assert.equal(saves().length, 0);
                assert.deepEqual(form.payload.formRecord.data, initial);
            } else {
                assert.equal(availability(), 'ready');
                assert.equal(displayed(driver), true);
                assert.equal(displayed(witness), true);
                assert.equal(witness.disabled, true);
                witness.value = 'Injected readonly value';
                witness.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                driver.value = 'allowed edited';
                driver.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                show.checked = false;
                show.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                assert.equal(displayed(driver), false);
                assert.equal(displayed(witness), true);
                assert.equal(availability(), 'ready');
                assert(beta());
                assert.equal(beta().disabled, false);
                assert.equal(beta().textContent, 'Projected Beta');
                assert.equal(
                    [...select.options].some(
                        (option) => option.value === 'Gamma'
                    ),
                    false
                );
                beta().selected = true;
                change(window, select);
                assert.equal(saves().length, 0);
                const expected = {
                    ...initial,
                    fld_projection_show: false,
                    fld_projection_driver: 'allowed edited',
                    [choiceId]: scenario.multiple ? ['Beta'] : 'Beta',
                };
                const assertSave = (call, data) => {
                    assert.deepEqual(call.input.formRecord, {
                        type: 'edit',
                        tableId: fixture.state.expected.tableId,
                        recordId: fixture.state.expected.recordId,
                        data,
                    });
                    assert.deepEqual(
                        [...call.input.formFieldIdsWithUnsavedChanges].sort(),
                        [
                            'fld_projection_show',
                            'fld_projection_driver',
                            choiceId,
                        ].sort()
                    );
                    assert.equal(
                        call.input.extensionAccessToken,
                        'FAKE_SYNTHETIC_PROJECTION_TOKEN'
                    );
                    assert.deepEqual(call.input.context, {
                        type: 'direct-url',
                    });
                    assert.deepEqual(
                        call.input
                            .conditionalLinkedRecordFieldIdsToFilteringValues,
                        {}
                    );
                };
                submit(window, select.closest('form'));
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        window.document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assertSave(saves()[0], expected);
                show.checked = true;
                show.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                assert.equal(displayed(driver), true);
                assert.equal(driver.value, 'allowed edited');
                assert.deepEqual(selected(select).filter(Boolean), ['Beta']);
                assert.equal(beta().textContent, 'Projected Beta');
                for (const option of select.options) option.selected = false;
                if (!scenario.multiple) select.value = '';
                change(window, select);
                denied();
                assert.deepEqual(selected(select).filter(Boolean), []);
                assert.equal(saves().length, 1);
                submit(window, select.closest('form'));
                await waitFor(
                    () =>
                        saves().length === 2 &&
                        window.document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assertSave(saves()[1], {
                    ...expected,
                    fld_projection_show: true,
                    [choiceId]: scenario.multiple ? [] : null,
                });
                button(window.document, "Clear this visitor's session").click();
                show.checked = false;
                show.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                driver.value = 'stale retired owner';
                driver.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                change(window, select);
                assert.equal(saves().length, 2);
                button(window.document, 'Reload').click();
                await waitFor(
                    () => selectFor() !== null && selectFor() !== select
                );
                assert.equal(
                    window.document.querySelector(
                        'input[data-field-id="fld_projection_driver"]'
                    ).value,
                    initial.fld_projection_driver
                );
                assert.deepEqual(selected(selectFor()).filter(Boolean), []);
                denied();
                assert.equal(saves().length, 2);
            }
            assert.deepEqual(fixture.state.unexpected, []);
            assert.deepEqual(
                fixture.state.calls.map((call) => call.route),
                scenario.blocked
                    ? ['fetchExtensionForEndUser']
                    : [
                          'fetchExtensionForEndUser',
                          'saveForm',
                          'saveForm',
                          'fetchExtensionForEndUser',
                      ]
            );
            assert.deepEqual(form.payload.formRecord.data, initial);
            console.log(
                `[packed projection ${revision + 1}/${scenarios.length}] ${scenario.name}: passed`
            );
        } catch (error) {
            throw new Error(
                `Packed projection scenario failed: ${scenario.name}`,
                { cause: error }
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
    return scenarios.length;
};

const checkPackedPortalSelects = async ({ consumer, Window, outfile }) => {
    const scenarios = [
        {
            name: 'Portal ID allowlist uses native names',
            restricted: true,
            config: {
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
                conditionsForOptions: [],
                conditionalFields: { logicalOperator: 'and', conditions: [] },
            },
        },
        {
            name: 'Portal conditional option labels cannot authorize inline writes',
            locked: true,
            config: {
                enableConditionalOptions: true,
                conditionsForOptions: [
                    {
                        id: 'blue_label',
                        config: {
                            optionForConditions: 'sel_blue',
                            name: ' Azure ',
                            conditionsForOption: {
                                logicalOperator: 'and',
                                conditions: [],
                            },
                        },
                    },
                ],
            },
        },
        {
            name: 'Portal choice names do not match allowed IDs',
            noAllowedChoices: true,
            config: { singleOrMultiSelectLimitSelectionOptions: ['Blue'] },
        },
        {
            name: 'Portal over-limit baseline and removal',
            maximum: true,
            config: { maxNumberOfSelections: 2 },
        },
        {
            name: 'Portal zero maximum permits removal only',
            zero: true,
            config: { maxNumberOfSelections: 0 },
        },
        {
            name: 'Portal empty allowlist and native multi names',
            config: { singleOrMultiSelectLimitSelectionOptions: [] },
        },
        {
            name: 'Portal nonempty option config blocks even when disabled',
            locked: true,
            config: {
                enableConditionalOptions: false,
                conditionsForOptions: [
                    {
                        id: 'blue_label',
                        config: {
                            optionForConditions: 'sel_blue',
                            name: 'Ignored label',
                            conditionsForOption: {
                                logicalOperator: 'and',
                                conditions: [],
                            },
                        },
                    },
                ],
            },
        },
        {
            name: 'Portal single-select native name',
            single: true,
            restricted: true,
            config: {
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
            },
        },
        {
            name: 'Portal nonempty conditional fields do not become inline permission',
            locked: true,
            config: {
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'nested_empty_group',
                            type: 'groupCondition',
                            logicalOperator: 'and',
                            conditions: [],
                        },
                    ],
                },
            },
        },
        {
            name: 'Portal read-only has no inline dispatch',
            locked: true,
            config: { readOnly: true },
        },
        {
            name: 'Portal computed has no inline dispatch',
            locked: true,
            computed: true,
            config: {},
        },
    ];
    let revision = 0;
    for (const scenario of scenarios) {
        const window = new Window({
            url: 'https://example.test',
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
        const portal = portalRecipeFixtures.makePortal();
        const parentConfig =
            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
        parentConfig.disableInlineEdit = false;
        parentConfig.customViews = [
            { id: 'view_example', config: { name: 'Example view' } },
        ];
        const schema =
            makeSelectForm(scenario).payload.fieldIdsToSchemas.fld_colors;
        portal.payload.linkedRecordFieldIdToDetailFields.fld_children = [
            {
                fieldId: 'fld_colors',
                fieldName: 'Colors',
                titleOverride: null,
                isHidden: false,
                fieldIsInEditingChildForm: true,
                childFormField: null,
                miniExtConfig: schema.miniExtConfig,
            },
        ];
        const baseline = scenario.single
            ? 'Legacy'
            : scenario.maximum
              ? ['Legacy', 'Red', 'Older']
              : ['Legacy', 'Red'];
        let nativeValue = structuredClone(baseline);
        const updates = [];
        const unexpected = [];
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route') ?? url.pathname;
            if (route === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(portal));
            if (route === 'fetchRecordsForLinkedTableOnPortal')
                return new Response(
                    JSON.stringify({
                        airtableOffset: null,
                        recordIds: ['rec_one'],
                        customViewDetailFields: null,
                        tableIdsToLinkedTableStates: {
                            tbl_children: {
                                airtableFields: [schema.airtableField],
                                recordIdsToAirtableRecords: {
                                    rec_one: {
                                        id: 'rec_one',
                                        fields: { fld_colors: nativeValue },
                                    },
                                },
                            },
                        },
                    })
                );
            if (route === '/api/trpc/airtable.updatePortalRecord') {
                const value = JSON.parse(String(init.body));
                updates.push(value);
                nativeValue = structuredClone(value.value);
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                record: {
                                    id: 'rec_one',
                                    fields: { fld_colors: nativeValue },
                                },
                                auditTrail: null,
                                auditTrails: [],
                            },
                        },
                    })
                );
            }
            if (route === '/api/trpc/airtable.getUserRecord')
                return new Response(JSON.stringify({ result: { data: null } }));
            unexpected.push(route);
            throw new Error(
                'Packed Portal select attempted an unexpected call.'
            );
        };
        function Option(text = '', value = '') {
            const option = window.document.createElement('option');
            option.textContent = text;
            option.value = value;
            return option;
        }
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            Option,
            fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            await import(`${pathToFileURL(outfile).href}?portal=${++revision}`);
            const document = window.document;
            document.getElementById('api-origin').value =
                'https://sdk.example.test';
            document.getElementById('share-id').value = 'share_example';
            submit(window, document.getElementById('connection-form'));
            await waitFor(() =>
                [...document.querySelectorAll('button')].some(
                    (node) => node.textContent === 'Load records'
                )
            );
            const load = async () => {
                button(document, 'Load records').click();
                await waitFor(
                    () =>
                        document.querySelector(
                            'tr[data-record-id="rec_one"]'
                        ) !== null &&
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
            };
            await load();
            if (scenario.locked) {
                assert.equal(
                    [...document.querySelectorAll('button')].some(
                        (node) => node.textContent === 'Edit cell'
                    ),
                    false
                );
                assert.equal(
                    document.querySelector(
                        'select[data-field-id="fld_colors"]'
                    ),
                    null
                );
                assert.deepEqual(updates, []);
            } else {
                const open = () => {
                    button(document, 'Edit cell').click();
                    const select = document.querySelector(
                        'select[data-field-id="fld_colors"]'
                    );
                    assert(select);
                    return select;
                };
                const save = async (select) => {
                    const count = updates.length;
                    submit(window, select.closest('form'));
                    await waitFor(
                        () =>
                            updates.length === count + 1 &&
                            document
                                .getElementById('screen')
                                .getAttribute('aria-busy') === 'false'
                    );
                };
                let select = open();
                assert.deepEqual(
                    new Set(selected(select)),
                    new Set(scenario.single ? [baseline] : baseline)
                );
                const originalForm = select.closest('form');
                assert(originalForm);
                await save(select);
                assert.deepEqual(updates[0].value, baseline);
                select = open();
                const blue = [...select.options].find(
                    (option) => option.value === 'Blue'
                );
                if (scenario.noAllowedChoices) assert.equal(blue, undefined);
                else {
                    assert(blue);
                    assert.equal(blue.textContent, 'Blue');
                }
                if (scenario.single) {
                    select.value = 'Blue';
                    change(window, select);
                } else {
                    if (scenario.maximum || scenario.zero) {
                        blue.disabled = false;
                        blue.selected = true;
                        change(window, select);
                        assert.deepEqual(
                            new Set(selected(select)),
                            new Set(baseline)
                        );
                    }
                    for (const option of select.options)
                        option.selected =
                            scenario.maximum && option.value === 'Red';
                    change(window, select);
                    if (blue) {
                        blue.disabled = false;
                        blue.selected = true;
                        change(window, select);
                    }
                    if (
                        scenario.restricted ||
                        scenario.noAllowedChoices ||
                        scenario.zero
                    ) {
                        const injected = document.createElement('option');
                        injected.value =
                            scenario.noAllowedChoices || scenario.zero
                                ? 'Blue'
                                : 'Red';
                        injected.selected = true;
                        select.append(injected);
                        change(window, select);
                    }
                }
                const expected = scenario.single
                    ? 'Blue'
                    : scenario.noAllowedChoices || scenario.zero
                      ? []
                      : scenario.maximum
                        ? ['Red', 'Blue']
                        : ['Blue'];
                const staleForm = select.closest('form');
                assert(staleForm);
                await save(select);
                assert.deepEqual(updates.at(-1), {
                    portalExtensionAccessToken: 'portal_access_example',
                    portalFieldId: 'fld_children',
                    recordFieldId: 'fld_colors',
                    recordId: 'rec_one',
                    value: expected,
                    selectedCustomViewId: 'view_example',
                });
                assert.equal(
                    document.querySelector(
                        'input[placeholder="New choice name"]'
                    ),
                    null
                );
                const count = updates.length;
                submit(window, originalForm);
                submit(window, staleForm);
                select = open();
                const cachedForm = select.closest('form');
                assert(cachedForm);
                const retainedSelection = selected(select);
                const visitor = document.getElementById('visitor');
                visitor.value = 'B';
                change(window, visitor);
                submit(window, cachedForm);
                visitor.value = 'A';
                change(window, visitor);
                assert.deepEqual(selected(select), retainedSelection);
                submit(window, cachedForm);
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(updates.length, count);
                await load();
                const fresh = open();
                assert.notEqual(fresh, select);
                button(document, 'Cancel').click();
                const canceledForm = fresh.closest('form');
                // The detached element's closest form is retained by the caller,
                // even after closeEditor removes the card from the document.
                assert(canceledForm);
                submit(window, canceledForm);
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(updates.length, count);
            }
            assert.deepEqual(unexpected, []);
            console.log(
                `[packed Portal select ${revision}/${scenarios.length}] ${scenario.name}: passed`
            );
        } catch (error) {
            throw new Error(
                `Packed Portal select scenario failed: ${scenario.name}`,
                { cause: error }
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
    return scenarios.length;
};
