import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { createEditHideEmptyFixture } from './build-privacy-browser-proof.mjs';

const predicate = {
    logicalOperator: 'and',
    conditions: [
        {
            id: 'editor-private-id',
            type: 'singleCondition',
            setting: {
                type: 'is',
                fieldType: 'checkbox',
                idOrName: { type: 'id', id: 'fld_driver' },
                value: true,
            },
        },
    ],
};
const text = (id, config = {}) => ({
    fieldType: 'singleLineText',
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig: config,
});
const makeForm = () => {
    const form = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    form.payload.hasParentExtension = false;
    form.payload.fieldIdsInForm = ['fld_driver', 'fld_title', 'fld_readonly'];
    form.payload.fieldIdsToSchemas = {
        fld_driver: {
            fieldType: 'checkbox',
            airtableField: {
                ...text('fld_driver').airtableField,
                config: {
                    type: 'checkbox',
                    options: { icon: 'check', color: 'greenBright' },
                },
            },
        },
        fld_title: text('fld_title', { conditionalFields: predicate }),
        fld_readonly: text('fld_readonly', {
            readOnly: true,
            conditionalFields: predicate,
        }),
    };
    form.payload.formRecord = {
        type: 'edit',
        recordId: 'record_visibility',
        tableId: 'table_visibility',
        data: {
            fld_driver: false,
            fld_title: 'Retained title',
            fld_readonly: 'Locked',
            fld_number: 0,
            fld_select: ['Legacy', 'Red'],
            fld_linked: ['record_parent'],
            fld_barcode: { text: '001' },
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};

/** Execute the shipped recipe against the exact installed public Form exports. */
export async function checkFormVisibilityRecipe({
    consumerDirectory,
    guideSources,
}) {
    const root = realpathSync(consumerDirectory);
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const require = createRequire(join(root, 'package.json'));
    assert(
        realpathSync(require.resolve('@miniextensions/sdk/forms')).startsWith(
            `${installed}/dist/`
        )
    );
    const matches = guideSources
        .map((name) => join(root, name))
        .filter((path) =>
            readFileSync(path, 'utf8').includes(
                'export function onePageVisibility('
            )
        );
    assert.equal(
        matches.length,
        1,
        'Missing unique shipped one-page visibility recipe'
    );
    const { code } = await transform(readFileSync(matches[0], 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${matches[0]}.visibility.mjs`;
    writeFileSync(
        compiled,
        `${code}\nexport const recipeFormsUrl = import.meta.resolve('@miniextensions/sdk/forms');\n`
    );
    const { onePageVisibility, recipeFormsUrl } = await import(
        pathToFileURL(compiled).href
    );
    assert(
        realpathSync(fileURLToPath(recipeFormsUrl)).startsWith(
            `${installed}/dist/`
        )
    );
    const loaded = makeForm();
    const draft = {
        data: structuredClone(loaded.payload.formRecord.data),
        dirtyFieldIds: ['fld_title'],
    };
    const original = structuredClone(draft);
    assert.equal(onePageVisibility(loaded, draft).fld_title.type, 'hidden');
    assert.equal(onePageVisibility(loaded, draft).fld_readonly.type, 'hidden');
    draft.data.fld_driver = true;
    assert.equal(onePageVisibility(loaded, draft).fld_title.type, 'visible');
    draft.data.fld_driver = false;
    assert.equal(onePageVisibility(loaded, draft).fld_title.type, 'hidden');
    assert.deepEqual(draft, original);
    loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
        conditionalFields: predicate,
        headerSectionTitle: 'Details',
        applyFieldConditionsToSection: true,
    };
    loaded.payload.fieldIdsToSchemas.fld_readonly.miniExtConfig = {
        readOnly: true,
    };
    assert.equal(onePageVisibility(loaded, draft).fld_readonly.type, 'hidden');
    loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig.enableSectionHeader = false;
    assert.equal(onePageVisibility(loaded, draft).fld_readonly.type, 'visible');
    draft.data.fld_driver = { error: 'private native fault' };
    const blocked = onePageVisibility(loaded, draft).fld_title;
    assert.equal(blocked.type, 'blocked');
    assert.equal(JSON.stringify(blocked).includes('private'), false);
    draft.data.fld_driver = true;
    assert.equal(onePageVisibility(loaded, draft).fld_title.type, 'visible');
    const commonjs = require('@miniextensions/sdk/forms');
    for (const name of [
        'evaluateFormFieldVisibility',
        'composeFormFieldVisibility',
    ])
        assert.equal(typeof commonjs[name], 'function');
    assert.equal(
        commonjs.evaluateFormFieldVisibility({
            field: loaded.payload.fieldIdsToSchemas.fld_title,
            airtableFields: Object.values(loaded.payload.fieldIdsToSchemas).map(
                (schema) => schema.airtableField
            ),
            data: draft.data,
            formRecordType: 'edit',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        }).type,
        'visible'
    );
    return { checks: 8 };
}

/** Mount the copied starter with its installed archive, retaining native Save data. */
export async function checkBrowserVisibilityExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const root = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(root, '.generated/visibility-main-checks.mjs');
    const bundled = await build({
        absWorkingDir: root,
        entryPoints: [join(root, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(bundled.metafile, root);
    const loaded = makeForm();
    const saves = [];
    let loads = 0;
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    window.document.write(
        readFileSync(join(root, 'index.html'), 'utf8').replace(
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
        fetch: async (input, init) => {
            const route = new URL(String(input)).searchParams.get('route');
            if (route === 'fetchExtensionForEndUser') {
                loads++;
                return new Response(JSON.stringify(loaded));
            }
            if (route === 'saveForm') {
                saves.push(JSON.parse(String(init?.body)));
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    })
                );
            }
            throw new Error('Unexpected packed visibility request.');
        },
    };
    const previous = Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
    ]);
    Object.assign(globalThis, globals);
    const waitFor = async (predicate) => {
        for (let turn = 0; turn < 100; turn++) {
            if (predicate()) return;
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.fail(
            'Packed visibility starter did not reach the expected state.'
        );
    };
    const shown = (id) => {
        const node = window.document.querySelector(`[data-field-id="${id}"]`);
        return node !== null && node.closest('[hidden]') === null;
    };
    try {
        await import(pathToFileURL(outfile).href);
        window.document.getElementById('api-origin').value =
            'https://sdk.example.test';
        window.document.getElementById('share-id').value = 'share_example';
        window.document
            .getElementById('connection-form')
            .dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        await waitFor(() => shown('fld_driver'));
        assert.equal(shown('fld_title'), false);
        assert.equal(shown('fld_readonly'), false);
        const driver = window.document.querySelector(
            '[data-field-id="fld_driver"]'
        );
        const toggle = (checked) => {
            driver.checked = checked;
            driver.dispatchEvent(new window.Event('change', { bubbles: true }));
        };
        toggle(true);
        assert.equal(shown('fld_title'), true);
        const target = window.document.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.equal(target.value, 'Retained title');
        target.value = 'Accepted packed draft';
        target.dispatchEvent(new window.Event('input', { bubbles: true }));
        toggle(false);
        assert.equal(shown('fld_title'), false);
        target.value = 'Retained hidden callback must not write';
        target.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(target.value, 'Accepted packed draft');
        assert.equal(saves.length, 0);
        driver
            .closest('form')
            .dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        await waitFor(
            () =>
                saves.length === 1 &&
                window.document
                    .getElementById('screen')
                    .getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(saves[0].formRecord, {
            ...loaded.payload.formRecord,
            data: {
                ...loaded.payload.formRecord.data,
                fld_title: 'Accepted packed draft',
            },
        });
        assert.deepEqual(
            new Set(saves[0].formFieldIdsWithUnsavedChanges),
            new Set(['fld_driver', 'fld_title'])
        );
        toggle(true);
        assert.equal(shown('fld_title'), true);
        assert.equal(target.value, 'Accepted packed draft');

        // This is a legitimate published single-select condition, outside the
        // helper's direct scalar scope. It must block the actual Save sink.
        loaded.payload.fieldIdsInForm = ['fld_title', 'fld_readonly'];
        loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'published_select_condition',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleSelect',
                            idOrName: { type: 'id', id: 'fld_select' },
                            value: 'sel_red',
                        },
                    },
                ],
            },
        };
        loaded.payload.fieldIdsToSchemas.fld_readonly.miniExtConfig = {};
        loaded.payload.fieldIdsToSchemas.fld_select = {
            fieldType: 'singleSelect',
            airtableField: {
                ...text('fld_select').airtableField,
                config: {
                    type: 'singleSelect',
                    options: { choices: [{ id: 'sel_red', name: 'Red' }] },
                },
            },
        };
        loaded.payload.formRecord.data.fld_select = 'Red';
        const blockedBaseline = structuredClone(loaded.payload.formRecord);
        window.document.getElementById('reload').click();
        await waitFor(
            () =>
                loads === 2 &&
                window.document
                    .getElementById('screen')
                    .getAttribute('aria-busy') === 'false'
        );
        assert.equal(shown('fld_title'), false);
        const unavailable = [
            ...window.document.querySelectorAll('[role="alert"]'),
        ].find((node) =>
            node.textContent?.includes('Some fields cannot be displayed')
        );
        assert(unavailable);
        assert.equal(unavailable.hidden, false);
        const adjacent = window.document.querySelector(
            '[data-field-id="fld_readonly"]'
        );
        assert(adjacent);
        adjacent.value = 'Adjacent accepted packed draft';
        adjacent.dispatchEvent(new window.Event('input', { bubbles: true }));
        adjacent
            .closest('form')
            .dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        await waitFor(
            () =>
                window.document.getElementById('status').textContent ===
                'Review the unavailable fields before saving this Form.'
        );
        assert.equal(
            saves.length,
            1,
            'Blocked visibility must dispatch zero additional Saves.'
        );
        assert.equal(adjacent.value, 'Adjacent accepted packed draft');
        assert.equal(
            window.document.querySelector('[data-field-id="fld_title"]').value,
            'Retained title'
        );
        assert.deepEqual(loaded.payload.formRecord, blockedBaseline);
        const visitor = window.document.getElementById('visitor');
        assert(visitor);
        for (const identity of ['B', 'A']) {
            visitor.value = identity;
            visitor.dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
        }
        assert.equal(
            window.document.querySelector('[data-field-id="fld_readonly"]')
                .value,
            'Adjacent accepted packed draft'
        );
        assert.equal(
            window.document.querySelector('[data-field-id="fld_title"]').value,
            'Retained title'
        );
        assert.equal(saves.length, 1);
        loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
            conditionalFields: { logicalOperator: 'and', conditions: [] },
        };
        window.document.getElementById('reload').click();
        await waitFor(
            () =>
                loads === 3 &&
                shown('fld_title') &&
                window.document
                    .getElementById('screen')
                    .getAttribute('aria-busy') === 'false'
        );
        const recoveredMessage = [
            ...window.document.querySelectorAll('[role="alert"]'),
        ].find((node) =>
            node.textContent?.includes('Some fields cannot be displayed')
        );
        assert(recoveredMessage);
        assert.equal(recoveredMessage.hidden, true);
        const fresh = window.document.querySelector(
            '[data-field-id="fld_readonly"]'
        );
        assert(fresh);
        assert.equal(fresh.value, 'Locked');
        fresh.value = 'After reload accepted packed';
        fresh.dispatchEvent(new window.Event('input', { bubbles: true }));
        fresh
            .closest('form')
            .dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        // Dispatch is earlier than the response handler and run.finally.
        // Keep the mounted browser globals until the real Save settles.
        await waitFor(
            () =>
                saves.length === 2 &&
                window.document.getElementById('status').textContent ===
                    'The Form was not saved. Review the validation errors.' &&
                window.document
                    .getElementById('screen')
                    .getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(saves[1].formRecord, {
            ...blockedBaseline,
            data: {
                ...blockedBaseline.data,
                fld_readonly: 'After reload accepted packed',
            },
        });
        assert.deepEqual(saves[1].formFieldIdsWithUnsavedChanges, [
            'fld_readonly',
        ]);
    } finally {
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
    }
    return { checks: 2 };
}

/** Three finite boundaries against the actual installed public Form exports. */
export async function checkEditHideEmptyRecipe({ consumerDirectory }) {
    const root = realpathSync(consumerDirectory);
    const require = createRequire(join(root, 'package.json'));
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    assert(
        realpathSync(require.resolve('@miniextensions/sdk/forms')).startsWith(
            `${installed}/dist/`
        )
    );
    const {
        evaluateFormFieldVisibility: evaluate,
        composeFormFieldVisibility: compose,
        createFormSaveInput,
        createFlatScalarFormRecordProjection: project,
    } = require('@miniextensions/sdk/forms');
    const fixture = createEditHideEmptyFixture('hide-empty-edit');
    const loaded = fixture.page();
    const schemas = loaded.payload.fieldIdsToSchemas;
    const data = structuredClone(loaded.payload.formRecord.data);
    const before = structuredClone({ loaded, data });
    const base = {
        airtableFields: Object.values(schemas).map(
            (schema) => schema.airtableField
        ),
        data,
        formRecordType: 'edit',
        evaluationMode: 'runtime',
        invalidConditionMode: 'strict',
    };
    const positive = {
        singleLineText: 'answer',
        email: 'a@example.test',
        url: 'https://example.test',
        multilineText: 'answer',
        phoneNumber: '555',
        richText: '**literal**',
        number: 0,
        currency: 0,
        percent: 0,
        rating: 1,
        checkbox: true,
        barcode: { text: '004', type: 'code128' },
    };
    // HE-I1: all twelve direct physical families, their empty/populated twins,
    // edit polarity, readonly and preview. No returned native input is changed.
    for (const id of loaded.payload.fieldIdsInForm.slice(0, 12)) {
        const field = schemas[id];
        const type = field.airtableField.config.type;
        const empty =
            type === 'checkbox'
                ? false
                : type === 'rating'
                  ? 0
                  : type === 'barcode'
                    ? { text: '   ', type: 'code128' }
                    : null;
        for (const evaluationMode of ['runtime', 'preview']) {
            assert.deepEqual(
                evaluate({
                    ...base,
                    field,
                    evaluationMode,
                    data: { ...data, [id]: empty },
                }),
                { type: 'hidden', diagnostics: [] }
            );
            assert.deepEqual(
                evaluate({
                    ...base,
                    field,
                    evaluationMode,
                    data: { ...data, [id]: positive[type] },
                }),
                { type: 'visible', diagnostics: [] }
            );
            assert.deepEqual(
                evaluate({
                    ...base,
                    field,
                    evaluationMode,
                    formRecordType: 'create',
                    data: { ...data, [id]: empty },
                }),
                { type: 'visible', diagnostics: [] }
            );
        }
        for (const hideFieldIfEmpty of [undefined, false]) {
            const copy = structuredClone(field);
            copy.miniExtConfig.hideFieldIfEmpty = hideFieldIfEmpty;
            assert.deepEqual(
                evaluate({
                    ...base,
                    field: copy,
                    data: { ...data, [id]: null },
                }),
                { type: 'visible', diagnostics: [] }
            );
        }
    }
    for (const value of [undefined, null, '', '   '])
        assert.deepEqual(
            evaluate({
                ...base,
                field: schemas.fld_empty_email,
                data: { ...data, fld_empty_email: value },
            }),
            { type: 'hidden', diagnostics: [] }
        );
    assert.equal(schemas.fld_empty_email.miniExtConfig.readOnly, true);
    // HE-I2: populated targets still consume the full accepted conditional
    // context. Empty hiding precedes runtime compilation and preview bypass.
    const target = structuredClone(schemas.fld_empty_title);
    target.miniExtConfig.conditionalFields = {
        ...predicate,
        conditions: predicate.conditions.map((entry) => ({
            ...entry,
            setting: {
                ...entry.setting,
                idOrName: { type: 'id', id: 'fld_empty_checkbox' },
            },
        })),
    };
    for (const driver of [false, true, false])
        assert.equal(
            evaluate({
                ...base,
                field: target,
                data: { ...data, fld_empty_checkbox: driver },
            }).type,
            driver ? 'visible' : 'hidden'
        );
    assert.equal(
        evaluate({ ...base, field: target, evaluationMode: 'preview' }).type,
        'visible'
    );
    target.miniExtConfig.conditionalFields.conditions[0].setting.fieldType =
        'richText';
    target.miniExtConfig.conditionalFields.conditions[0].setting.idOrName.id =
        'fld_empty_rich';
    target.miniExtConfig.conditionalFields.conditions[0].setting.value =
        'PrivateEmptyFixture rich equality';
    const richDenied = evaluate({ ...base, field: target });
    assert.equal(richDenied.type, 'blocked');
    assert.equal(richDenied.code, 'unsupported');
    assert.equal(
        JSON.stringify(richDenied).includes('PrivateEmptyFixture'),
        false
    );
    assert.deepEqual(
        evaluate({
            ...base,
            field: target,
            data: { ...data, fld_empty_title: ' ' },
        }),
        { type: 'hidden', diagnostics: [] }
    );
    assert.equal(
        evaluate({ ...base, field: target, evaluationMode: 'preview' }).type,
        'visible'
    );
    const blocked = (field, value, code = 'unsupported-hide-empty') => {
        const actual = evaluate({
            ...base,
            field,
            data: { ...data, [field.airtableField.id]: value },
        });
        assert.equal(actual.type, 'blocked');
        assert.equal(actual.code, code);
        assert.equal(
            JSON.stringify(actual).includes('PrivateEmptyFixture'),
            false
        );
    };
    for (const type of ['date', 'multipleRecordLinks']) {
        const field = structuredClone(schemas.fld_empty_title);
        field.fieldType = type;
        field.airtableField.config = {
            type,
            options:
                type === 'date'
                    ? { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }
                    : {
                          linkedTableId: 'tbl_empty_linked',
                          isReversed: false,
                          prefersSingleRecordLink: false,
                      },
        };
        blocked(field, null);
    }
    for (const change of [
        (field) => {
            field.airtableField.isComputed = true;
        },
        (field) => {
            field.fieldType = 'email';
        },
        (field) => {
            field.miniExtConfig.headerSectionTitle =
                'PrivateEmptyFixture section';
            field.miniExtConfig.enableSectionHeader = false;
        },
        (field) => {
            field.miniExtConfig.applyFieldConditionsToSection = true;
        },
    ]) {
        const field = structuredClone(schemas.fld_empty_title);
        change(field);
        blocked(field, null);
    }
    for (const [id, value, code] of [
        ['fld_empty_number', '0', 'invalid-native-value'],
        ['fld_empty_number', NaN, 'non-finite-result'],
        ['fld_empty_number', Infinity, 'non-finite-result'],
        ['fld_empty_number', -Infinity, 'non-finite-result'],
        ['fld_empty_checkbox', 'false', 'invalid-native-value'],
        ['fld_empty_title', ['PrivateEmptyFixture'], 'invalid-native-value'],
        [
            'fld_empty_title',
            { error: 'PrivateEmptyFixture' },
            'invalid-native-value',
        ],
        [
            'fld_empty_barcode',
            { text: '', error: 'PrivateEmptyFixture' },
            'invalid-native-value',
        ],
        [
            'fld_empty_barcode',
            { text: '', specialValue: 'NaN' },
            'invalid-native-value',
        ],
        ['fld_empty_barcode', { text: '', type: 3 }, 'invalid-native-value'],
        ['fld_empty_barcode', 'PrivateEmptyFixture', 'invalid-native-value'],
    ])
        blocked(schemas[id], value, code);
    for (const text of [null, undefined])
        assert.deepEqual(
            evaluate({
                ...base,
                field: schemas.fld_empty_barcode,
                data: { ...data, fld_empty_barcode: { text } },
            }),
            { type: 'hidden', diagnostics: [] }
        );
    assert.equal(
        evaluate({
            ...base,
            field: schemas.fld_empty_title,
            data: { ...data, fld_empty_title: '#ERROR!' },
        }).type,
        'visible'
    );
    for (const section of [
        { headerSectionTitle: 'Retained section', enableSectionHeader: false },
        { applyFieldConditionsToSection: true },
    ]) {
        const copy = structuredClone(schemas);
        copy.fld_empty_tail.miniExtConfig = section;
        assert.deepEqual(
            compose({
                ...base,
                fieldIds: loaded.payload.fieldIdsInForm,
                fieldIdsToSchemas: copy,
            }).fld_empty_title,
            { type: 'blocked', code: 'unsupported-hide-empty', diagnostics: [] }
        );
    }
    // HE-I3: conditional projection and Save remain distinct from presentation.
    const draft = {
        data: {
            ...data,
            fld_empty_title: ' ',
            fld_empty_tail: 'Accepted sibling',
        },
        dirtyFieldIds: ['fld_empty_title', 'fld_empty_tail'],
    };
    assert.equal(
        evaluate({ ...base, field: schemas.fld_empty_title, data: draft.data })
            .type,
        'hidden'
    );
    const projected = project({
        fieldIds: ['fld_empty_title', 'fld_empty_tail'],
        fieldIdsToSchemas: schemas,
        airtableFields: base.airtableFields,
        data: draft.data,
        recordId: loaded.payload.formRecord.recordId,
        invalidConditionMode: 'strict',
    });
    assert.equal(projected.type, 'available');
    assert.deepEqual(projected.hiddenFieldIds, []);
    assert.deepEqual(projected.record.fields, draft.data);
    const saved = createFormSaveInput({
        loaded,
        draft,
        options: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    assert.deepEqual(saved.formRecord, {
        ...loaded.payload.formRecord,
        data: draft.data,
    });
    assert.deepEqual(saved.formFieldIdsWithUnsavedChanges, [
        'fld_empty_title',
        'fld_empty_number',
        'fld_empty_tail',
    ]);
    assert.equal(
        saved.extensionAccessToken,
        loaded.payload.extensionAccessToken
    );
    assert.deepEqual({ loaded, data }, before);
    return { checks: 3 };
}

/** Three actual packed starter journeys; synthetic returned errors only. */
export async function checkBrowserEditHideEmptyExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const root = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(root, '.generated/hide-empty-main-checks.mjs');
    const bundled = await build({
        absWorkingDir: root,
        entryPoints: [join(root, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(bundled.metafile, root);
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('dist/esm/forms/visibility.js')
        )
    );
    for (const [index, scenario] of [
        'hide-empty-edit',
        'hide-empty-create',
        'hide-empty-unavailable',
    ].entries()) {
        const fixture = createEditHideEmptyFixture(scenario);
        const original = structuredClone(fixture.state.expected.initial);
        const window = new Window({
            url: 'https://empty-starter.example.test',
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        window.document.write(
            readFileSync(join(root, 'index.html'), 'utf8').replace(
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
        const doc = window.document;
        const control = (id) => {
            const node = doc.querySelector(`[data-field-id="fld_empty_${id}"]`);
            assert(node);
            return node;
        };
        const shown = (id) => control(id).closest('[hidden]') === null;
        const edit = (id, value) => {
            const node = control(id);
            node.value = value;
            node.dispatchEvent(new window.Event('input', { bubbles: true }));
        };
        const click = (text) => {
            const matches = [...doc.querySelectorAll('#screen button')].filter(
                (node) => node.textContent.trim() === text
            );
            assert.equal(matches.length, 1);
            matches[0].click();
        };
        const saves = () =>
            fixture.state.calls.filter((call) => call.route === 'saveForm');
        const reads = () =>
            fixture.state.calls.filter(
                (call) => call.route === 'fetchExtensionForEndUser'
            );
        const waitFor = async (predicate) => {
            for (let turn = 0; turn < 100; turn++) {
                if (predicate()) return;
                await new Promise((resolve) => setImmediate(resolve));
            }
            assert.fail('Packed empty-hiding starter did not settle.');
        };
        const idle = () =>
            doc.getElementById('screen').getAttribute('aria-busy') === 'false';
        const assertSave = (data, dirtyIds) => {
            assert.equal(saves().length, 1);
            const call = saves()[0];
            assert.equal(call.method, 'POST');
            assert.equal(
                call.input.extensionAccessToken,
                'FAKE_SYNTHETIC_HIDE_EMPTY_TOKEN'
            );
            assert.deepEqual(call.input.formRecord, {
                ...fixture.page().payload.formRecord,
                data,
            });
            assert.deepEqual(
                call.input.formFieldIdsWithUnsavedChanges,
                dirtyIds
            );
            assert.deepEqual(call.input.context, { type: 'direct-url' });
            assert.equal(call.input.isComputeMode, false);
            assert.deepEqual(
                call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
                {}
            );
        };
        const roundTrip = () => {
            const visitor = doc.getElementById('visitor');
            for (const identity of ['B', 'A']) {
                visitor.value = identity;
                visitor.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
            }
        };
        try {
            await import(`${pathToFileURL(outfile).href}?hide-empty=${index}`);
            doc.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            doc.getElementById('share-id').value = 'privacy_share_synthetic';
            doc.getElementById('connection-form').dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
            await waitFor(
                () =>
                    doc.querySelector('[data-field-id="fld_empty_tail"]') &&
                    idle()
            );
            assert.equal(reads().length, 1);
            assert.equal(control('email').disabled, true);
            assert.equal(control('locked').disabled, true);
            if (scenario === 'hide-empty-edit') {
                for (const id of [
                    'email',
                    'url',
                    'multiline',
                    'phone',
                    'rich',
                    'rating',
                    'checkbox',
                    'barcode',
                ])
                    assert.equal(shown(id), false);
                for (const id of [
                    'title',
                    'number',
                    'currency',
                    'percent',
                    'locked',
                    'tail',
                ])
                    assert.equal(shown(id), true);
                edit('title', ' ');
                assert.equal(shown('title'), false);
                assert.equal(control('title').value, ' ');
                edit('tail', 'Accepted empty-hiding sibling');
                click('Save');
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        idle() &&
                        doc
                            .getElementById('status')
                            .textContent.includes('validation errors')
                );
                assertSave(
                    {
                        ...original,
                        fld_empty_title: ' ',
                        fld_empty_tail: 'Accepted empty-hiding sibling',
                    },
                    ['fld_empty_title', 'fld_empty_number', 'fld_empty_tail']
                );
                assert(
                    doc
                        .querySelector('.error-list')
                        .textContent.includes(
                            `Hidden required answer: ${fixture.state.expected.validationMessage}`
                        )
                );
                roundTrip();
                assert.equal(shown('title'), false);
                assert.equal(control('title').value, ' ');
                assert.equal(
                    control('tail').value,
                    'Accepted empty-hiding sibling'
                );
                assert.equal(saves().length, 1);
                assert.equal(reads().length, 1);
                click('Discard draft');
                assert.equal(shown('title'), true);
                assert.equal(control('title').value, original.fld_empty_title);
                assert.equal(control('tail').value, original.fld_empty_tail);
                assert.equal(saves().length, 1);
            } else if (scenario === 'hide-empty-create') {
                for (const id of fixture.state.expected.controlFieldIds)
                    assert.equal(
                        control(id.replace('fld_empty_', '')).closest(
                            '[hidden]'
                        ),
                        null
                    );
                edit('tail', 'Accepted create sibling');
                click('Save');
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        idle() &&
                        doc
                            .getElementById('status')
                            .textContent.includes('validation errors')
                );
                assertSave(
                    { ...original, fld_empty_tail: 'Accepted create sibling' },
                    ['fld_empty_title', 'fld_empty_number', 'fld_empty_tail']
                );
                assert.equal(saves()[0].input.formRecord.type, 'create');
            } else {
                assert.equal(shown('title'), false);
                assert.equal(shown('tail'), true);
                const alert = doc.querySelector('form.card > p[role="alert"]');
                assert(alert);
                assert.equal(alert.hidden, false);
                edit('tail', 'Accepted blocked sibling');
                click('Save');
                await waitFor(
                    () =>
                        doc.getElementById('status').textContent ===
                        'Review the unavailable fields before saving this Form.'
                );
                assert.equal(saves().length, 0);
                roundTrip();
                assert.equal(control('tail').value, 'Accepted blocked sibling');
                assert.equal(control('title').value, '');
                assert.equal(saves().length, 0);
                assert.equal(reads().length, 1);
                doc.getElementById('reload').click();
                await waitFor(
                    () => reads().length === 2 && idle() && shown('title')
                );
                assert.equal(control('tail').value, original.fld_empty_tail);
                assert.equal(
                    doc.querySelector('form.card > p[role="alert"]').hidden,
                    true
                );
                assert.equal(saves().length, 0);
                edit('tail', 'Accepted recovered sibling');
                click('Save');
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        idle() &&
                        doc
                            .getElementById('status')
                            .textContent.includes('validation errors')
                );
                assertSave(
                    {
                        ...original,
                        fld_empty_tail: 'Accepted recovered sibling',
                    },
                    ['fld_empty_title', 'fld_empty_number', 'fld_empty_tail']
                );
            }
            assert.deepEqual(fixture.state.unexpected, []);
            assert.deepEqual(fixture.state.expected.initial, original);
            assert.deepEqual(
                fixture.state.calls.map((call) => call.route),
                scenario === 'hide-empty-unavailable'
                    ? [
                          'fetchExtensionForEndUser',
                          'fetchExtensionForEndUser',
                          'saveForm',
                      ]
                    : ['fetchExtensionForEndUser', 'saveForm']
            );
            assert(
                fixture.state.calls.every(
                    (call) => call.credentialsMode === 'omit'
                )
            );
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            }
            await window.happyDOM.close();
        }
    }
    return { checks: 3 };
}
