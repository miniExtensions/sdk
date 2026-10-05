import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

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
    return { checks: scenarios.length };
}
