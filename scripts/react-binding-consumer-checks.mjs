import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Actual installed package; React is supplied by this consumer, never the core. */
export async function checkReactBindingConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const react = consumer('react');
    const { createElement, StrictMode, act } = react;
    const { createRoot } = consumer('react-dom/client');
    const packageRoot = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    const api = await import(
        pathToFileURL(join(packageRoot, 'dist/esm/react/index.js'))
    );
    const forms = await import(
        pathToFileURL(join(packageRoot, 'dist/esm/forms/index.js'))
    );
    const portals = await import(
        pathToFileURL(join(packageRoot, 'dist/esm/portals/index.js'))
    );
    const cjs = consumer('@miniextensions/sdk/react');
    for (const name of [
        'TextField',
        'SelectField',
        'LinkedField',
        'AttachmentField',
        'AttachmentDialog',
        'useFieldBinding',
    ]) {
        assert.equal(typeof api[name], 'function');
        assert.equal(typeof cjs[name], 'function');
    }
    const loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.hasParentExtension = false;
    const attachmentId = 'fld_files';
    loaded.payload.fieldIdsInForm.push(
        attachmentId,
        'fld_parent',
        'fld_choices'
    );
    loaded.payload.fieldIdsToSchemas.fld_choices = {
        fieldType: 'multipleSelects',
        airtableField: {
            id: 'fld_choices',
            name: 'Choices',
            isComputed: false,
            config: {
                type: 'multipleSelects',
                options: {
                    choices: [
                        { id: 'a', name: 'Alpha' },
                        { id: 'b', name: 'Beta' },
                    ],
                },
            },
        },
        miniExtConfig: { maxNumberOfSelections: 1 },
    };
    loaded.payload.formRecord.data.fld_choices = [];
    loaded.payload.fieldIdsToSchemas[attachmentId] = {
        fieldType: 'multipleAttachments',
        airtableField: {
            id: attachmentId,
            name: 'Files',
            isComputed: false,
            config: {
                type: 'multipleAttachments',
                options: { isReversed: false },
            },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data[attachmentId] = [];
    const textId = Object.keys(loaded.payload.fieldIdsToSchemas).find(
        (id) =>
            loaded.payload.fieldIdsToSchemas[id].fieldType === 'singleLineText'
    );
    assert(
        textId && attachmentId,
        'consumer fixture needs actual text and attachment schemas'
    );
    let writes = 0;
    const saves = [];
    const client = {
        getSession: () => ({}),
        forms: {
            save: async (input) => {
                writes++;
                saves.push(structuredClone(input));
                return {
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                };
            },
        },
        attachments: {
            uploadFile: async () => {
                writes++;
                throw Error('No upload expected');
            },
        },
    };
    const owner = forms.createFormFieldBindings({
        loaded,
        client,
        getScope: () => ({ ownerId: 'A', revision: 0 }),
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            context: {
                type: 'modal',
                prefillData: {
                    toLinkToParent: null,
                    prefillQueryForChildExtension: null,
                },
            },
            searchQuery: {},
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    owner.setLinkedOptions('fld_parent', [
        { value: 'rec_user', label: 'Existing parent' },
        { value: 'rec_alpha', label: 'Authorized Alpha' },
    ]);
    const model = owner.attachment(attachmentId, {
        journal: new forms.RecoveryJournal(),
        loadVersion: 1,
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: loaded.extensionId,
            context: 'modal',
        },
    });
    const selected = new window.File(['bytes'], 'PRIVATE_pending.txt', {
        type: 'text/plain',
    });
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container);
    let closes = 0;
    const tree = () =>
        createElement(
            StrictMode,
            null,
            createElement(api.TextField, { binding: owner.field(textId) }),
            createElement(api.TextField, {
                binding: owner.field(textId),
                render: ({ snapshot, binding }) =>
                    createElement('input', {
                        'aria-label': 'Custom text',
                        value:
                            typeof snapshot.value === 'string'
                                ? snapshot.value
                                : '',
                        onChange: (event) =>
                            binding.setValue(event.currentTarget.value),
                    }),
            }),
            createElement(api.SelectField, {
                binding: owner.field('fld_choices'),
            }),
            createElement(api.SelectField, {
                binding: owner.field('fld_choices'),
                render: ({ binding }) =>
                    createElement(
                        'button',
                        {
                            type: 'button',
                            'data-custom-select': true,
                            onClick: () => binding.setValue(['Beta']),
                        },
                        'Choose Beta'
                    ),
            }),
            createElement(api.LinkedField, {
                binding: owner.field('fld_parent'),
            }),
            createElement(api.LinkedField, {
                binding: owner.field('fld_parent'),
                render: ({ binding }) =>
                    createElement(
                        'button',
                        {
                            type: 'button',
                            'data-custom-linked': true,
                            onClick: () =>
                                binding.selection.toggle('rec_alpha'),
                        },
                        'Toggle linked'
                    ),
            }),
            createElement(api.AttachmentDialog, {
                onClose: () => closes++,
                children: createElement(api.AttachmentField, {
                    binding: owner.field(attachmentId),
                    controller: model,
                }),
            })
        );
    try {
        assert.equal(model.select([selected]), true);
        await act(async () => root.render(tree()));
        await act(async () =>
            owner.field(textId).setValue('Shared native text')
        );
        const textInputs = [
            ...container.querySelectorAll(
                'div > label > input:not([type=checkbox]), input[aria-label="Custom text"]'
            ),
        ];
        assert.equal(textInputs.length, 2);
        textInputs.forEach((input) =>
            assert.equal(input.value, 'Shared native text')
        );
        assert.equal(owner.field(textId).getSnapshot().dirty, true);
        await act(async () =>
            container.querySelector('input[type=file]').dispatchEvent(
                new window.Event('cancel', {
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(closes, 0);
        assert.equal(model.getSnapshot().files[0], selected);
        assert.equal(container.innerHTML.includes('PRIVATE_pending'), false);
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(
            owner.field(textId).getSnapshot().value,
            'Shared native text'
        );
        assert.equal(model.getSnapshot().files[0], selected);
        assert.equal(model.select([]), false);
        assert.equal(model.getSnapshot().files[0], selected);
        await act(async () =>
            container.querySelector('dialog').dispatchEvent(
                new window.Event('cancel', {
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(closes, 1);
        const stockSelect = container.querySelector('select');
        await act(async () => {
            [...stockSelect.options].forEach((option) => {
                option.selected = option.value === 'Alpha';
            });
            stockSelect.dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
        });
        assert.deepEqual(owner.field('fld_choices').getSnapshot().value, [
            'Alpha',
        ]);
        await act(async () =>
            container.querySelector('[data-custom-select]').click()
        );
        assert.deepEqual(owner.field('fld_choices').getSnapshot().value, [
            'Beta',
        ]);
        assert.equal(
            container.querySelector('select').selectedOptions[0].value,
            'Beta'
        );
        await act(async () =>
            container.querySelector('[data-custom-linked]').click()
        );
        assert.deepEqual(owner.field('fld_parent').getSnapshot().value, [
            'rec_user',
            'rec_alpha',
        ]);
        assert.equal(
            container.querySelectorAll('input[type=checkbox]:checked').length,
            2
        );
        assert.equal(writes, 0);
        await assert.rejects(owner.save()); // selected, unsent file never becomes a committed answer
        assert.equal(writes, 0);
        await act(async () => model.clear());
        await act(async () => owner.save());
        assert.equal(writes, 1);
        assert.deepEqual(
            saves[0].formRecord.data,
            owner.controller.getState().draft.data
        );
        assert.equal(
            saves[0].formFieldIdsWithUnsavedChanges.includes(textId),
            true
        );
        assert.equal(
            saves[0].formFieldIdsWithUnsavedChanges.includes('fld_choices'),
            true
        );
        assert.equal(
            saves[0].formFieldIdsWithUnsavedChanges.includes('fld_parent'),
            true
        );
        const oldLinked = owner.field('fld_parent');
        await act(async () =>
            oldLinked.selection.setSearchInput('PRIVATE visitor A query')
        );
        assert.equal(
            container.querySelector('fieldset input:not([type=checkbox])')
                .value,
            'PRIVATE visitor A query'
        );
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(
            container.querySelector('fieldset input:not([type=checkbox])')
                .value,
            'PRIVATE visitor A query'
        );
        owner.destroy();
        const successor = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => ({ ownerId: 'B', revision: 1 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        await act(async () =>
            root.render(
                createElement(api.LinkedField, {
                    binding: successor.field('fld_parent'),
                })
            )
        );
        assert.equal(
            container.querySelector('fieldset input:not([type=checkbox])')
                .value,
            ''
        );
        await act(async () =>
            oldLinked.selection.setSearchInput('Late old A query')
        );
        assert.equal(
            container.querySelector('fieldset input:not([type=checkbox])')
                .value,
            ''
        );
        successor.destroy();
        const returned = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => ({ ownerId: 'A', revision: 2 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        await act(async () =>
            root.render(
                createElement(api.LinkedField, {
                    binding: returned.field('fld_parent'),
                })
            )
        );
        assert.equal(
            container.querySelector('fieldset input:not([type=checkbox])')
                .value,
            ''
        );
        assert.equal(writes, 1);
        returned.destroy();
        // The same optional React renderer consumes a Portal cell binding, without a Form load.
        const gridCalls = [];
        const portalClient = {
            getSession: () => ({}),
            portals: {
                updateGridCell: async (input) => {
                    gridCalls.push(structuredClone(input));
                    return {
                        record: {
                            id: input.recordId,
                            fields: { [input.recordFieldId]: input.value },
                        },
                        auditTrail: null,
                        auditTrails: [],
                    };
                },
            },
        };
        const cell = portals.createPortalCellBinding({
            client: portalClient,
            schema: loaded.payload.fieldIdsToSchemas.fld_title,
            value: 'Cell initial',
            input: {
                portalExtensionAccessToken: 'portal-token',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_title',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'A', revision: 0 }),
            isCurrent: () => true,
            recovery: {
                journal: new forms.RecoveryJournal(),
                scope: {
                    owner: 'A',
                    parentFieldId: 'fld_children',
                    tableId: 'tbl_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        await act(async () =>
            root.render(
                createElement(
                    StrictMode,
                    {},
                    createElement(api.TextField, { binding: cell.binding })
                )
            )
        );
        await act(async () => cell.binding.setValue('Cell custom edit'));
        assert.equal(
            container.querySelector('input').value,
            'Cell custom edit'
        );
        await act(async () => root.render(null));
        await act(async () =>
            root.render(
                createElement(api.TextField, {
                    binding: cell.binding,
                    render: ({ snapshot, binding }) =>
                        createElement(
                            'button',
                            {
                                onClick: () =>
                                    binding.setValue('Cell render-prop edit'),
                            },
                            snapshot.value
                        ),
                })
            )
        );
        assert.equal(
            container.querySelector('button').textContent,
            'Cell custom edit'
        );
        await act(async () => container.querySelector('button').click());
        assert.equal(cell.binding.getSnapshot().value, 'Cell render-prop edit');
        assert.equal(gridCalls.length, 0);
        await act(async () => cell.save());
        assert.deepEqual(gridCalls, [
            {
                portalExtensionAccessToken: 'portal-token',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_title',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
                value: 'Cell render-prop edit',
            },
        ]);
        cell.destroy();
        return {
            checks: 1,
            reactVersion: react.version,
            proof: 'installed ESM/CommonJS, StrictMode/remount and synthetic cancel; no OS picker or persistence',
        };
    } finally {
        await act(async () => root.unmount());
        owner.destroy();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
