import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { assertBrowserInputs } from './package-checks.mjs';
import {
    createReviewFixture,
    createHideEmptyReviewFixture,
} from './build-privacy-browser-proof.mjs';

export function addSelectReviewAnswers(page) {
    const choices = [
        { id: 'sel_first', name: 'First' },
        { id: 'sel_second', name: 'Second' },
    ];
    for (const [id, type, value] of [
        ['fld_review_single', 'singleSelect', 'First'],
        [
            'fld_review_multi',
            'multipleSelects',
            [
                'Second',
                'First',
                'Second',
                'sel_first',
                '<i>Label</i>',
                '<b>Unknown</b>',
                '   ',
            ],
        ],
    ]) {
        page.payload.fieldIdsInForm.push(id);
        page.payload.fieldIdsToSchemas[id] = {
            fieldType: type,
            airtableField: {
                id,
                name: id,
                config: {
                    type,
                    options: { choices: structuredClone(choices) },
                },
            },
            miniExtConfig: {
                readOnly: true,
                enableConditionalOptions: true,
                singleOrMultiSelectLimitSelectionOptions: ['sel_first'],
                conditionsForOptions: [
                    {
                        config: {
                            optionForConditions: 'sel_first',
                            name: '<i>Label</i>',
                        },
                    },
                    {
                        config: {
                            optionForConditions: 'sel_second',
                            name: '<i>Label</i>',
                        },
                    },
                ],
            },
        };
        page.payload.formRecord.data[id] = structuredClone(value);
    }
    return [
        '<i>Label</i> (First)',
        '<i>Label</i> (Second)\n<i>Label</i> (First)\n<i>Label</i> (Second)\nsel_first (unavailable)\n<i>Label</i> (unavailable)\n<b>Unknown</b> (unavailable)\n    (unavailable)',
    ];
}

/** Pure archived Review contract: no empty-hiding helper or browser mutation. */
export function assertCanonicalBlankReviewMatrix(prepareFormReviewRows) {
    const fixture = createReviewFixture('review-answers');
    const loaded = fixture.page();
    const types = [
        'singleLineText',
        'email',
        'url',
        'multilineText',
        'phoneNumber',
        'number',
        'currency',
        'percent',
        'rating',
        'checkbox',
        'barcode',
    ];
    const schemas = types.map((type) => ({
        fieldType: type,
        airtableField: {
            id: `fld_pure_blank_${type}`,
            name: `Pure blank ${type}`,
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type,
                options:
                    type === 'checkbox'
                        ? { icon: 'check', color: 'greenBright' }
                        : type === 'rating'
                          ? { max: 5, icon: 'star', color: 'yellowBright' }
                          : type === 'currency'
                            ? { precision: 2, symbol: '$' }
                            : ['number', 'percent'].includes(type)
                              ? { precision: 2 }
                              : null,
            },
        },
        miniExtConfig: {},
    }));
    loaded.payload.fieldIdsInForm = schemas.map(
        (schema) => schema.airtableField.id
    );
    loaded.payload.fieldIdsToSchemas = Object.fromEntries(
        schemas.map((schema) => [schema.airtableField.id, schema])
    );
    loaded.payload.fieldNamesToSchemas = Object.fromEntries(
        schemas.map((schema) => [schema.airtableField.name, schema])
    );
    const beforeLoaded = structuredClone(loaded);
    for (const blank of ['', ' \t\n ']) {
        const data = {
            ...structuredClone(loaded.payload.formRecord.data),
            ...Object.fromEntries(
                loaded.payload.fieldIdsInForm.map((id) => [id, blank])
            ),
        };
        const before = structuredClone(data);
        assert.deepEqual(prepareFormReviewRows(loaded, data), []);
        assert.deepEqual(data, before);
        assert.deepEqual(loaded, beforeLoaded);
    }
    assert.deepEqual(fixture.state.calls, []);
}

/** Execute the actual archive-copied review and confirmation recipe modules. */
export async function checkFormReviewRecipe({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    for (const name of ['review.ts', 'confirmation.ts', 'dom.ts'])
        assert.deepEqual(
            readFileSync(join(consumer, 'src', name)),
            readFileSync(join(installed, 'examples/browser/src', name))
        );
    const entry = join(consumer, '.generated/review-recipe-entry.ts');
    writeFileSync(
        entry,
        "export { prepareFormReviewRows } from '../src/review.js';\nexport { requestConfirmation, cancelConfirmation } from '../src/confirmation.js';\nexport { createFormSaveInput, evaluateFormFieldVisibility } from '@miniextensions/sdk/forms';\n"
    );
    const outfile = join(consumer, '.generated/review-recipe-checks.mjs');
    const bundled = await build({
        absWorkingDir: consumer,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        metafile: true,
        logLevel: 'silent',
    });
    await assertBrowserInputs(bundled.metafile, consumer);
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('src/review.ts')
        )
    );
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('dist/esm/forms/projection.js')
        )
    );
    assert(
        Object.keys(bundled.metafile.inputs).some((path) =>
            path.endsWith('dist/esm/ui/selectPolicy.js')
        )
    );
    const {
        prepareFormReviewRows,
        requestConfirmation,
        cancelConfirmation,
        createFormSaveInput,
        evaluateFormFieldVisibility,
    } = await import(pathToFileURL(outfile).href);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const fixture = createReviewFixture('review-answers');
    const page = fixture.page();
    const native = structuredClone(page.payload.formRecord.data);
    native.fld_review_show = false;
    native.fld_review_title = 'EditedSecretForArchive';
    native.fld_review_conditional = 'Edited hidden native answer';
    const original = structuredClone(native);
    const rows = prepareFormReviewRows(page, native);
    assert.deepEqual(rows, [
        {
            fieldId: 'fld_review_title',
            title: '<b>Semantic secret</b>',
            value: '••••••••',
            hideTitle: true,
        },
        {
            fieldId: 'fld_review_readonly',
            title: 'Plain readonly answer',
            value: '<img src=x onerror=alert(1)>',
            hideTitle: false,
        },
        {
            fieldId: 'fld_review_url',
            title: 'Plain URL answer',
            value: native.fld_review_url,
            hideTitle: false,
        },
        {
            fieldId: 'fld_review_number',
            title: 'Zero count',
            value: '0',
            hideTitle: false,
        },
    ]);
    assert.deepEqual(native, original);
    assert.deepEqual(native.fld_review_unrendered_linked, [
        'rec_review_parent',
    ]);
    let checks = 1;
    const selectPage = structuredClone(page);
    const expectedSelect = addSelectReviewAnswers(selectPage);
    const selectNative = structuredClone(selectPage.payload.formRecord.data);
    const beforeSelect = structuredClone(selectNative);
    const selectRows = prepareFormReviewRows(selectPage, selectNative);
    assert.deepEqual(
        selectRows.slice(-2).map((row) => row.value),
        expectedSelect
    );
    assert.deepEqual(selectNative, beforeSelect);
    const canonical = JSON.parse(
        readFileSync('test/fixtures/reviewSelect.json', 'utf8')
    );
    assert.equal(
        canonical.provenance.revision,
        '58f73d575ab10baa0a10693660d8002f204368e1'
    );
    assert.equal(
        canonical.provenance.generatorSHA256,
        createHash('sha256')
            .update(readFileSync(canonical.provenance.generator))
            .digest('hex')
    );
    for (const c of canonical.cases) {
        const p = structuredClone(selectPage);
        const schema = p.payload.fieldIdsToSchemas.fld_review_multi;
        schema.airtableField.config.options.choices = c.choices;
        schema.miniExtConfig = c.config;
        const data = {
            ...selectNative,
            fld_review_multi: c.choices.map((choice) => choice.name),
        };
        assert.equal(
            prepareFormReviewRows(p, data).find(
                (row) => row.fieldId === 'fld_review_multi'
            ).value,
            c.expected.map((choice) => choice.displayName).join('\n')
        );
    }
    assert.equal(canonical.unknown.displayName, '<b>Unknown</b>');
    assert.equal(
        prepareFormReviewRows(selectPage, {
            ...selectNative,
            fld_review_single: canonical.unknown.displayName,
        }).find((row) => row.fieldId === 'fld_review_single').value,
        '<b>Unknown</b> (unavailable)'
    );
    for (const options of [undefined, { choices: [] }]) {
        const p = structuredClone(selectPage);
        p.payload.fieldIdsToSchemas.fld_review_single.airtableField.config.options =
            options;
        assert.equal(
            prepareFormReviewRows(p, selectNative).find(
                (row) => row.fieldId === 'fld_review_single'
            ).value,
            'First (unavailable)'
        );
    }
    const fallback = structuredClone(selectPage);
    for (const choices of [
        [
            { id: 'duplicate', name: 'PrivateFirst' },
            { id: 'duplicate', name: 'PrivateSecond' },
        ],
        [
            { id: 'one', name: 'PrivateDuplicate' },
            { id: 'two', name: 'PrivateDuplicate' },
        ],
        [null],
        [{ id: 123, name: 'PrivateMalformed' }],
        [{ id: 'one', name: null }],
        { private: 'PrivateContainer' },
    ]) {
        const p = structuredClone(selectPage);
        p.payload.fieldIdsToSchemas.fld_review_single.airtableField.config.options.choices =
            choices;
        assert.throws(
            () => prepareFormReviewRows(p, selectNative),
            (error) =>
                error.message.startsWith('Review is unavailable') &&
                !error.message.includes('Private')
        );
    }
    fallback.payload.fieldIdsToSchemas.fld_review_single.miniExtConfig.conditionsForOptions[0].config.name = 123;
    assert.equal(
        prepareFormReviewRows(fallback, selectNative).find(
            (row) => row.fieldId === 'fld_review_single'
        ).value,
        'First'
    );
    for (const type of ['multipleAttachments', 'richText', 'date']) {
        const p = structuredClone(selectPage);
        p.payload.fieldIdsToSchemas.fld_review_single.fieldType = type;
        p.payload.fieldIdsToSchemas.fld_review_single.airtableField.config = {
            type,
        };
        assert.throws(
            () =>
                prepareFormReviewRows(p, {
                    ...selectNative,
                    fld_review_single: null,
                }),
            /Review is unavailable/
        );
    }
    const hiddenEmpty = structuredClone(selectPage);
    hiddenEmpty.payload.fieldIdsToSchemas.fld_review_single.miniExtConfig.hideFieldIfEmpty = true;
    assert.equal(
        evaluateFormFieldVisibility({
            field: hiddenEmpty.payload.fieldIdsToSchemas.fld_review_single,
            airtableFields: Object.values(
                hiddenEmpty.payload.fieldIdsToSchemas
            ).map((s) => s.airtableField),
            data: selectNative,
            formRecordType: 'edit',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        }).code,
        'unsupported-hide-empty'
    );
    const driver = structuredClone(selectPage);
    const setting =
        driver.payload.fieldIdsToSchemas.fld_review_conditional.miniExtConfig
            .conditionalFields.conditions[0].setting;
    setting.idOrName.id = 'fld_review_single';
    setting.fieldType = 'singleSelect';
    setting.value = 'First';
    assert.throws(
        () => prepareFormReviewRows(driver, selectNative),
        /Review is unavailable/
    );
    for (const [id, values] of [
        ['fld_review_single', [1, true, {}, [], ['First']]],
        [
            'fld_review_multi',
            [1, true, {}, ['First', null], ['First', 1], [''], new Array(1)],
        ],
    ])
        for (const value of values) {
            const data = structuredClone(selectNative);
            data[id] = value;
            assert.throws(
                () => prepareFormReviewRows(selectPage, data),
                (error) =>
                    error.message.startsWith('Review is unavailable') &&
                    !error.message.includes('First')
            );
        }
    for (const value of [undefined, null, '', '   ']) {
        const data = {
            ...selectNative,
            fld_review_single: value,
            fld_review_multi: value,
        };
        assert.deepEqual(
            prepareFormReviewRows(selectPage, data)
                .slice(-2)
                .map((row) => row.fieldId)
                .filter(
                    (id) =>
                        id.startsWith('fld_review_single') ||
                        id.startsWith('fld_review_multi')
                ),
            []
        );
    }
    assert(
        !prepareFormReviewRows(selectPage, {
            ...selectNative,
            fld_review_multi: [],
        }).some((row) => row.fieldId === 'fld_review_multi')
    );
    for (const id of [
        'fld_review_readonly',
        'fld_review_show',
        'fld_review_barcode',
        'fld_review_number',
    ]) {
        const p = structuredClone(selectPage);
        p.payload.fieldIdsToSchemas[id].miniExtConfig = { readOnly: true };
        assert.throws(
            () => prepareFormReviewRows(p, { ...selectNative, [id]: [] }),
            /Review is unavailable/
        );
    }
    for (const value of ['sel_first', '<i>Label</i>', 'first', ' First ']) {
        const data = { ...selectNative, fld_review_single: value };
        assert.equal(
            prepareFormReviewRows(selectPage, data).find(
                (row) => row.fieldId === 'fld_review_single'
            ).value,
            `${value} (unavailable)`
        );
    }
    const selectSave = createFormSaveInput({
        loaded: selectPage,
        draft: {
            data: selectNative,
            dirtyFieldIds: ['fld_review_single', 'fld_review_multi'],
        },
        options: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    assert.deepEqual(selectSave.formRecord.data, selectNative);
    assert.deepEqual(selectSave.formFieldIdsWithUnsavedChanges, [
        'fld_review_single',
        'fld_review_multi',
    ]);
    checks++;
    const empty = structuredClone(native);
    for (const id of page.payload.fieldIdsInForm)
        empty[id] =
            id === 'fld_review_show'
                ? false
                : id === 'fld_review_rating'
                  ? 0
                  : id === 'fld_review_barcode'
                    ? { text: '  ', type: 'code128' }
                    : null;
    assert.deepEqual(prepareFormReviewRows(page, empty), []);
    assert.deepEqual(empty.fld_review_unrendered_multi, ['Retained', 'Native']);
    checks++;
    assertCanonicalBlankReviewMatrix(prepareFormReviewRows);
    checks++;
    const combinedFixture = createHideEmptyReviewFixture('hide-empty-review');
    const combinedPage = combinedFixture.page();
    const combinedBefore = structuredClone(combinedPage);
    for (const blank of ['', ' \t\n ']) {
        const data = {
            ...structuredClone(combinedPage.payload.formRecord.data),
            ...Object.fromEntries(
                combinedFixture.state.expected.blankFieldIds.map((id) => [
                    id,
                    blank,
                ])
            ),
            fld_empty_tail: 'Accepted combined sibling',
        };
        const before = structuredClone(data);
        assert.deepEqual(prepareFormReviewRows(combinedPage, data), [
            {
                fieldId: 'fld_empty_locked',
                title: 'Empty locked',
                value: 'Retained readonly native answer',
                hideTitle: false,
            },
            {
                fieldId: 'fld_empty_tail',
                title: 'Empty tail',
                value: 'Accepted combined sibling',
                hideTitle: false,
            },
        ]);
        const input = createFormSaveInput({
            loaded: combinedPage,
            draft: { data, dirtyFieldIds: ['fld_empty_tail'] },
            options: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: {},
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        assert.deepEqual(input.formRecord, {
            ...combinedPage.payload.formRecord,
            data,
        });
        assert.deepEqual(input.formFieldIdsWithUnsavedChanges, [
            ...combinedFixture.state.expected.blankFieldIds,
            'fld_empty_tail',
        ]);
        assert.deepEqual(data, before);
        assert.deepEqual(combinedPage, combinedBefore);
    }
    assert.deepEqual(combinedFixture.state.calls, []);
    checks++;
    for (const kind of ['number', 'checkbox', 'barcode', 'rich', 'computed']) {
        const variant = structuredClone(combinedPage);
        const data = structuredClone(variant.payload.formRecord.data);
        if (kind === 'rich')
            variant.payload.fieldIdsInForm.push('fld_empty_rich');
        else if (kind === 'computed')
            variant.payload.fieldIdsToSchemas.fld_empty_number.airtableField.isComputed = true;
        else {
            data[`fld_empty_${kind}`] = `PrivateCombinedMalformed_${kind}`;
            variant.payload.fieldIdsToSchemas[
                `fld_empty_${kind}`
            ].miniExtConfig.hideFieldIfEmpty = false;
        }
        const before = structuredClone(data);
        assert.throws(
            () => prepareFormReviewRows(variant, data),
            /Review is unavailable/
        );
        assert.deepEqual(data, before);
    }
    checks++;
    for (const unsupported of [
        'multi-page',
        'compute',
        'automatic',
        'computed',
        'malformed-readonly',
    ]) {
        const variant = structuredClone(page);
        const data = structuredClone(native);
        if (unsupported === 'multi-page')
            variant.payload.publicFields.state.multiPageFormMode = 'multi-page';
        else if (unsupported === 'compute')
            variant.payload.publicFields.state.enableFormComputeMode = true;
        else if (unsupported === 'automatic')
            variant.payload.publicFields.state.autoSubmitAfterPrefill = true;
        else if (unsupported === 'computed')
            variant.payload.fieldIdsToSchemas.fld_review_readonly.airtableField.isComputed = true;
        else data.fld_review_readonly = ['Unsupported native array'];
        const before = structuredClone(data);
        assert.throws(
            () => prepareFormReviewRows(variant, data),
            /Review is unavailable/
        );
        assert.deepEqual(data, before);
        checks++;
    }
    const window = new Window({ url: 'https://review-recipe.example.test' });
    const globals = {
        document: window.document,
        HTMLElement: window.HTMLElement,
    };
    const previous = Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
    ]);
    Object.assign(globalThis, globals);
    try {
        const trigger = window.document.createElement('button');
        trigger.textContent = 'Save';
        window.document.body.append(trigger);
        const open = () => {
            trigger.focus();
            const decision = requestConfirmation({
                title: 'Review your answers',
                message: 'Review the captured answers.',
                confirmLabel: 'Confirm',
                cancelLabel: 'Edit',
                rows: selectRows,
            });
            const dialog = window.document.querySelector('dialog[open]');
            assert(dialog);
            const buttons = [...dialog.querySelectorAll('button')];
            const edit = buttons.find(
                (button) => button.textContent === 'Edit'
            );
            const confirm = buttons.find(
                (button) => button.textContent === 'Confirm'
            );
            assert(edit && confirm);
            assert.equal(window.document.activeElement, edit);
            assert.equal(dialog.getAttribute('role'), 'dialog');
            assert.equal(dialog.getAttribute('aria-modal'), 'true');
            assert.equal(dialog.querySelectorAll('img,b,a').length, 0);
            assert.equal(
                dialog.textContent.includes(native.fld_review_title),
                false
            );
            assert.deepEqual(
                [...dialog.querySelectorAll('dd')].map(
                    (node) => node.textContent
                ),
                selectRows.map((row) => row.value)
            );
            for (const label of dialog.querySelectorAll('dt'))
                assert.equal(
                    label.nextElementSibling.getAttribute('aria-labelledby'),
                    label.id
                );
            return { decision, dialog, edit, confirm };
        };
        let prompt = open();
        prompt.edit.click();
        assert.equal(await prompt.decision, false);
        assert.equal(window.document.activeElement, trigger);
        assert.equal(prompt.dialog.isConnected, false);
        checks++;
        prompt = open();
        prompt.dialog.dispatchEvent(
            new window.Event('cancel', { cancelable: true })
        );
        assert.equal(await prompt.decision, false);
        assert.equal(window.document.activeElement, trigger);
        checks++;
        prompt = open();
        cancelConfirmation();
        prompt.confirm.click();
        assert.equal(await prompt.decision, false);
        assert.equal(prompt.dialog.isConnected, false);
        checks++;
        prompt = open();
        prompt.confirm.click();
        prompt.confirm.click();
        assert.equal(await prompt.decision, true);
        assert.equal(window.document.querySelector('dialog'), null);
        assert.equal(window.document.activeElement, trigger);
        assert.deepEqual(native, original);
        checks++;
    } finally {
        cancelConfirmation();
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    }
    return { checks };
}
