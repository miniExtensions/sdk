import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Actual installed ESM/CommonJS controllers; synthetic upload calls, never remote persistence. */
export async function checkAttachmentUploadDispatchConsumer({
    consumerDirectory,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const installed = (entry) =>
        import(
            pathToFileURL(
                join(
                    consumerDirectory,
                    `node_modules/@miniextensions/sdk/dist/esm/${entry}/index.js`
                )
            )
        );
    const flavors = [
        {
            name: 'ESM',
            forms: await installed('forms'),
            runtime: await installed('runtime'),
        },
        {
            name: 'CommonJS',
            forms: require('@miniextensions/sdk/forms'),
            runtime: require('@miniextensions/sdk'),
        },
    ];
    let groups = 0;
    for (const { name, forms, runtime } of flavors) {
        const make = (cancelFromAttempt = false) => {
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
            const existing = {
                url: 'https://files.example.test/existing',
                filename: 'existing.txt',
            };
            loaded.payload.formRecord.data.fld_files = [existing, existing];
            let networkCalls = 0;
            let saveCalls = 0;
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { visitor: 'A' },
                fetch: async () => {
                    networkCalls++;
                    throw Error('No external request is permitted');
                },
            });
            client.forms.save = async () => {
                saveCalls++;
                return {
                    type: 'error',
                    formErrors: {},
                    formValidationErrors: [],
                };
            };
            const owner = forms.createFormFieldBindings({
                client,
                loaded,
                getScope: () => ({ ownerId: 'A', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const journal = new forms.RecoveryJournal();
            const scope = {
                owner: 'A',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            };
            const attempts = [];
            const controller = owner.attachment(
                'fld_files',
                { journal, scope, loadVersion: 1 },
                {
                    onAttempt(attempt) {
                        attempts.push(attempt);
                        if (cancelFromAttempt) {
                            cancelFromAttempt = false;
                            controller.cancel();
                        }
                    },
                }
            );
            const selected = new File(['content'], 'synthetic.txt', {
                type: 'text/plain',
            });
            const uploaded = {
                url: 'https://files.example.test/uploaded',
                filename: selected.name,
                id: null,
                size: selected.size,
                type: selected.type,
            };
            return {
                owner,
                client,
                controller,
                journal,
                scope,
                attempts,
                selected,
                uploaded,
                get networkCalls() {
                    return networkCalls;
                },
                get saveCalls() {
                    return saveCalls;
                },
            };
        };
        for (const cancellation of ['onAttempt', 'subscriber']) {
            const f = make(cancellation === 'onAttempt');
            const calls = [];
            let stop = () => {};
            try {
                f.client.attachments.uploadFile = async (input, options) => {
                    calls.push({ input, options });
                    return f.uploaded;
                };
                if (cancellation === 'subscriber') {
                    let cancelOnce = true;
                    stop = f.controller.subscribe((snapshot) => {
                        if (cancelOnce && snapshot.phase === 'uploading') {
                            cancelOnce = false;
                            f.controller.cancel();
                        }
                    });
                }
                const before = structuredClone(
                    f.owner.controller.getState().draft
                );
                assert.equal(f.controller.select([f.selected]), true);
                assert.equal(await f.controller.upload(), false);
                assert.equal(calls.length, 0, `${name} ${cancellation}`);
                assert.equal(f.attempts.length, 1);
                const first = f.attempts[0];
                assert.equal(first.outcome, 'not-dispatched');
                assert.equal(first.flight, false);
                assert.equal(first.acknowledgment, 'none');
                assert.deepEqual(first.retainedInput, []);
                assert.equal(f.journal.blocking(f.scope, null), undefined);
                assert.deepEqual(f.journal.unknown('A'), []);
                assert.deepEqual(f.owner.controller.getState().draft, before);
                assert.equal(f.controller.getSnapshot().files[0], f.selected);
                assert.equal(f.controller.getSnapshot().phase, 'selected');
                assert.equal(f.controller.getSnapshot().busy, false);
                assert.equal(f.controller.getSnapshot().error, null);
                assert.equal(f.controller.blocksForm(), false);
                assert.equal(f.owner.hasPendingFiles(), true);
                stop();
                // The same in-memory File is retried only by this explicit call.
                assert.equal(await f.controller.upload(), true);
                assert.equal(calls.length, 1);
                assert.equal(calls[0].input.file, f.selected);
                assert.equal(calls[0].input.filename, f.selected.name);
                assert.equal(calls[0].input.fieldId, 'fld_files');
                assert.equal(
                    calls[0].input.extensionAccessToken,
                    'child_access_example'
                );
                assert.deepEqual(calls[0].options.session, { visitor: 'A' });
                assert.equal(calls[0].options.signal.aborted, false);
                assert.equal(f.attempts.length, 2);
                assert.notEqual(f.attempts[1].id, first.id);
                assert.equal(first.outcome, 'not-dispatched');
                assert.equal(f.attempts[1].outcome, 'uploaded');
                assert.equal(f.attempts[1].flight, false);
                assert.deepEqual(
                    f.owner.field('fld_files').getSnapshot().value,
                    [...before.data.fld_files, f.uploaded]
                );
                assert.equal(
                    f.owner.field('fld_files').getSnapshot().dirty,
                    true
                );
                assert.deepEqual(f.controller.getSnapshot().files, []);
                assert.equal(f.controller.getSnapshot().phase, 'accepted');
                assert.equal(f.controller.blocksForm(), false);
                assert.equal(f.journal.blocking(f.scope, null), undefined);
                assert.equal(f.networkCalls, 0);
                assert.equal(f.saveCalls, 0);
                groups++;
            } finally {
                stop();
                f.owner.destroy();
            }
        }
        for (const outcome of ['synchronous-throw', 'cancel-after-call']) {
            const f = make();
            const calls = [];
            let resolveUpload;
            try {
                f.client.attachments.uploadFile = (input, options) => {
                    calls.push({ input, options });
                    if (outcome === 'synchronous-throw')
                        throw Error('Synthetic response loss after invocation');
                    return new Promise((resolve) => {
                        resolveUpload = resolve;
                    });
                };
                const before = structuredClone(
                    f.owner.controller.getState().draft
                );
                assert.equal(f.controller.select([f.selected]), true);
                const flight = f.controller.upload();
                assert.equal(calls.length, 1, `${name} ${outcome}`);
                if (outcome === 'cancel-after-call') {
                    assert.equal(f.controller.getSnapshot().busy, true);
                    f.controller.cancel();
                    assert.equal(calls[0].options.signal.aborted, true);
                    // An abort-ignoring uploader may still report stored bytes.
                    resolveUpload(f.uploaded);
                }
                assert.equal(await flight, false);
                assert.equal(f.attempts.length, 1);
                const attempt = f.attempts[0];
                assert.equal(attempt.outcome, 'unknown');
                assert.equal(attempt.flight, false);
                assert.equal(attempt.acknowledgment, 'none');
                assert.equal(f.journal.blocking(f.scope, null), attempt);
                assert.deepEqual(f.journal.unknown('A'), [attempt]);
                assert.deepEqual(f.owner.controller.getState().draft, before);
                assert.equal(f.controller.getSnapshot().files[0], f.selected);
                assert.equal(f.controller.getSnapshot().phase, 'uncertain');
                assert.equal(f.controller.getSnapshot().busy, false);
                assert.equal(f.controller.blocksForm(), true);
                assert.equal(await f.controller.upload(), false);
                assert.equal(calls.length, 1);
                // Clear only the local queue so the journal is the Save fence.
                f.controller.clear();
                assert.equal(f.owner.hasPendingFiles(), false);
                assert.equal(f.controller.blocksForm(), true);
                await assert.rejects(f.owner.save());
                assert.equal(f.saveCalls, 0);
                assert.equal(f.controller.select([f.selected]), false);
                assert.equal(f.attempts.length, 1);
                assert.equal(attempt.outcome, 'unknown');
                assert.deepEqual(f.owner.controller.getState().draft, before);
                assert.equal(f.networkCalls, 0);
                groups++;
            } finally {
                resolveUpload?.(f.uploaded);
                f.owner.destroy();
            }
        }
    }
    return groups;
}

/** Installed SDK and React with local synthetic Save validation; no browser/backend claim. */
export async function checkExistingAttachmentConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const uploadDispatchGroups = await checkAttachmentUploadDispatchConsumer({
        consumerDirectory,
    });
    assert.equal(uploadDispatchGroups, 8);
    console.log(
        `Installed attachment upload dispatch: ${uploadDispatchGroups} ESM/CommonJS controller groups passed (synthetic upload calls only, no remote persistence).`
    );
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
