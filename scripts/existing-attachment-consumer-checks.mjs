import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Installed SDK and React with local synthetic Save validation; no browser/backend claim. */
export async function checkExistingAttachmentConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
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
    const forms = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/forms/index.js'
            )
        )
    );
    const reactApi = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const { createElement, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    let root = null;
    let owner = null;
    let checks = 0;
    let heldRemove = null;
    const saves = [];
    const original = {
        url: 'https://files.example.test/PRIVATE_url',
        filename: 'PRIVATE_name.txt',
        thumbnails: {
            small: {
                url: 'https://files.example.test/PRIVATE_thumbnail',
                width: 1,
                height: 2,
            },
        },
    };
    const another = {
        url: 'https://files.example.test/another',
        filename: 'Another',
    };
    const loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.hasParentExtension = false;
    loaded.payload.fieldIdsInForm.push('fld_files');
    loaded.payload.fieldIdsToSchemas.fld_files = {
        fieldType: 'multipleAttachments',
        airtableField: {
            id: 'fld_files',
            name: 'Files',
            isComputed: false,
            isPrimaryField: false,
            description: null,
            config: {
                type: 'multipleAttachments',
                options: { isReversed: false },
            },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.fld_files = [original, original, another];
    let scope = { ownerId: 'A', revision: 0 };
    let permitted = true;
    const client = {
        getSession: () => ({}),
        forms: {
            save: async (input) => {
                saves.push(structuredClone(input));
                return {
                    type: 'error',
                    formErrors: {},
                    formValidationErrors: [],
                };
            },
        },
        attachments: {
            uploadFile: async () => {
                throw Error('No automatic upload');
            },
        },
    };
    const options = {
        client,
        loaded,
        getScope: () => scope,
        canWriteField: () => permitted,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            context: { type: 'direct-url' },
            searchQuery: {},
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    };
    const recovery = () => ({
        journal: new forms.RecoveryJournal(),
        loadVersion: 1,
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal',
        },
    });
    try {
        owner = forms.createFormFieldBindings(options);
        const controller = owner.attachment('fld_files', recovery());
        const container = window.document.createElement('div');
        window.document.body.append(container);
        root = createRoot(container);
        const tree = () =>
            createElement(
                StrictMode,
                null,
                createElement(reactApi.AttachmentField, {
                    binding: owner.field('fld_files'),
                    controller,
                }),
                createElement(reactApi.AttachmentField, {
                    binding: owner.field('fld_files'),
                    controller,
                    render: ({ attachment, controller: model }) =>
                        createElement(
                            'aside',
                            null,
                            createElement(
                                'p',
                                null,
                                attachment.files.length === 0
                                    ? 'Custom no pending files'
                                    : 'Custom pending files'
                            ),
                            ...attachment.rows.map((row) => {
                                heldRemove ??= () =>
                                    model.remove(
                                        attachment.valuesRevision,
                                        row.nativeIndex
                                    );
                                return createElement(
                                    'div',
                                    { key: row.nativeIndex },
                                    row.label,
                                    createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            disabled: !row.removeAllowed,
                                            onClick: () =>
                                                model.remove(
                                                    attachment.valuesRevision,
                                                    row.nativeIndex
                                                ),
                                        },
                                        'Custom remove'
                                    )
                                );
                            })
                        ),
                })
            );
        let cleared = false;
        const stopNested = controller.subscribe((snapshot) => {
            if (!cleared && snapshot.rows.length === 2) {
                cleared = true;
                controller.clear();
            }
        });
        await act(async () => root.render(tree()));
        assert.equal(container.innerHTML.includes('PRIVATE'), false);
        assert.deepEqual(
            controller.getSnapshot().rows.map((row) => row.label),
            ['Attachment', 'Attachment', 'Attachment']
        );
        checks++;
        const pending = new window.File(['x'], 'PRIVATE_pending.txt', {
            type: 'text/plain',
        });
        await act(async () => assert.equal(controller.select([pending]), true));
        const stock = [...container.querySelectorAll('button')].filter(
            (button) => button.textContent === 'Remove attachment'
        );
        const stale = stock.at(-1);
        await act(async () => stock[0].click());
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
            original,
            another,
        ]);
        assert.equal(cleared, true);
        assert.deepEqual(controller.getSnapshot().files, []);
        assert.ok(container.textContent.includes('No pending files'));
        assert.ok(container.textContent.includes('Custom no pending files'));
        stopNested();
        await act(async () => assert.equal(controller.select([pending]), true));
        assert.equal(saves.length, 0);
        checks++;
        assert.equal(heldRemove(), false);
        await act(async () =>
            stale.dispatchEvent(new window.Event('click', { bubbles: true }))
        );
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
            original,
            another,
        ]);
        checks++;
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(controller.getSnapshot().rows.length, 2);
        assert.equal(controller.getSnapshot().files[0], pending);
        checks++;
        const custom = [...container.querySelectorAll('button')].find(
            (button) => button.textContent === 'Custom remove'
        );
        await act(async () => custom.click());
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
            another,
        ]);
        assert.equal(controller.getSnapshot().files[0], pending);
        checks++;
        await assert.rejects(owner.save());
        assert.equal(saves.length, 0);
        await act(async () => controller.clear());
        await act(async () => owner.save());
        assert.equal(saves.length, 1);
        assert.deepEqual(saves[0].formRecord.data.fld_files, [another]);
        assert.ok(
            saves[0].formFieldIdsWithUnsavedChanges.includes('fld_files')
        );
        checks++;
        const before = controller.getSnapshot();
        before.rows[0].label = 'Mutation';
        assert.equal(controller.getSnapshot().rows[0].label, 'Attachment');
        checks++;
        await act(async () => {
            permitted = false;
            owner.refresh();
        });
        assert.deepEqual(controller.getSnapshot().rows, []);
        assert.equal(controller.remove(before.valuesRevision, 0), false);
        checks++;
        await act(async () => {
            permitted = true;
            owner.refresh();
        });
        assert.equal(controller.remove(before.valuesRevision, 0), false);
        checks++;
        await act(async () => {
            scope = { ownerId: 'B', revision: 1 };
            owner.refresh();
        });
        assert.equal(controller.getSnapshot().retired, true);
        assert.equal(controller.remove(before.valuesRevision, 0), false);
        checks++;
        await act(async () => root.unmount());
        root = null;
        owner.destroy();
        owner = null;
        for (const hide of [undefined, null, true, false]) {
            const form = structuredClone(loaded);
            form.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
                hideAttachmentName: hide,
                readOnly: true,
            };
            owner = forms.createFormFieldBindings({ ...options, loaded: form });
            const model = owner.attachment('fld_files', recovery());
            assert.equal(
                model.getSnapshot().rows[0].label,
                hide === false ? 'PRIVATE_name.txt' : 'Attachment'
            );
            assert.equal(model.getSnapshot().rows[0].removeAllowed, false);
            owner.destroy();
            owner = null;
            checks++;
        }
        const restricted = structuredClone(loaded);
        restricted.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
            allowedAttachmentTypes: ['images'],
        };
        owner = forms.createFormFieldBindings({
            ...options,
            loaded: restricted,
        });
        const restrictedController = owner.attachment('fld_files', recovery());
        let rejected = false;
        const stopRejected = restrictedController.subscribe((snapshot) => {
            if (!rejected && snapshot.rows.length === 2) {
                rejected = true;
                assert.equal(
                    restrictedController.select([
                        new window.File(['x'], 'bad.txt', {
                            type: 'text/plain',
                        }),
                    ]),
                    false
                );
            }
        });
        root = createRoot(container);
        await act(async () =>
            root.render(
                createElement(
                    StrictMode,
                    null,
                    createElement(reactApi.AttachmentField, {
                        binding: owner.field('fld_files'),
                        controller: restrictedController,
                    }),
                    createElement(reactApi.AttachmentField, {
                        binding: owner.field('fld_files'),
                        controller: restrictedController,
                        render: ({ attachment }) =>
                            createElement(
                                'aside',
                                null,
                                attachment.error ?? 'Custom no error'
                            ),
                    })
                )
            )
        );
        const restrictedView = restrictedController.getSnapshot();
        await act(async () =>
            assert.equal(
                restrictedController.remove(restrictedView.valuesRevision, 0),
                true
            )
        );
        assert.equal(rejected, true);
        assert.match(
            container.querySelector('aside').textContent,
            /cannot be added/
        );
        assert.match(
            container.querySelector('[role=status]').textContent,
            /cannot be added/
        );
        checks++;
        stopRejected();
        await act(async () => root.unmount());
        root = null;
        owner.destroy();
        owner = null;
        const form = structuredClone(loaded);
        form.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
            addOnlyMode: true,
            hideAttachmentName: false,
        };
        form.payload.persistedAddOnlyAttachmentValuesByFieldId = {
            fld_files: [original],
        };
        owner = forms.createFormFieldBindings({ ...options, loaded: form });
        const model = owner.attachment('fld_files', recovery());
        assert.deepEqual(
            model.getSnapshot().rows.map((row) => row.nativeIndex),
            [2]
        );
        assert.equal(
            model.remove(model.getSnapshot().valuesRevision, 0),
            false
        );
        assert.equal(model.remove(model.getSnapshot().valuesRevision, 2), true);
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
            original,
            original,
        ]);
        checks++;
        console.log(
            `Installed existing attachments: ${checks} stock/custom React and native-removal checkpoints passed (synthetic DOM/Save validation, no remote byte deletion or persistence).`
        );
        return checks;
    } finally {
        if (root) await act(async () => root.unmount());
        owner?.destroy();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
